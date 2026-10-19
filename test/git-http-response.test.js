const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { forwardGitHttpResponse } = require('../git-http-response');

async function requestChunks(chunks) {
  const server = http.createServer((_req, res) => {
    const stdout = Readable.from(chunks);
    forwardGitHttpResponse(stdout, res);
    stdout.on('end', () => res.end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${server.address().port}`, res => {
        const received = [];
        res.on('data', data => received.push(data));
        res.on('error', reject);
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(received) }));
      });
      request.on('error', reject);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const headers = Buffer.from('Content-Type: application/x-git-upload-pack-result\r\nCache-Control: no-cache\r\n\r\n');
// Include every byte value, including invalid UTF-8 sequences present in pack data.
const pack = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

test('preserves binary pack data in the same chunk as the CGI headers', async () => {
  const response = await requestChunks([Buffer.concat([headers, pack])]);
  assert.equal(response.headers['content-type'], 'application/x-git-upload-pack-result');
  assert.equal(response.headers['cache-control'], 'no-cache');
  assert.deepEqual(response.body, pack);
});

test('preserves binary data when the CGI header delimiter spans chunks', async () => {
  const response = await requestChunks([
    headers.subarray(0, headers.length - 1),
    Buffer.concat([headers.subarray(-1), pack.subarray(0, 200)]),
    pack.subarray(200)
  ]);
  assert.equal(response.headers['content-type'], 'application/x-git-upload-pack-result');
  assert.deepEqual(response.body, pack);
});

test('preserves a multibyte sequence split between the first body chunk and the next', async () => {
  const body = Buffer.from('PACK\u{1F600}');
  const response = await requestChunks([
    Buffer.concat([headers, body.subarray(0, 5)]), body.subarray(5)
  ]);
  assert.deepEqual(response.body, body);
});
