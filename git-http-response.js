// Forward CGI headers and body from git http-backend to an HTTP response.
function forwardGitHttpResponse(stdout, res) {
  let headers = Buffer.alloc(0);
  let headersParsed = false;

  stdout.on('data', (data) => {
    if (!headersParsed) {
      headers = Buffer.concat([headers, data]);
      const headerEnd = headers.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        headersParsed = true;
        const headerLines = headers.subarray(0, headerEnd).toString('latin1').split('\r\n');
        headerLines.forEach(line => {
          const [key, value] = line.split(': ');
          if (key && value) res.setHeader(key, value);
        });
        const bodyStart = headerEnd + 4;
        if (headers.length > bodyStart) res.write(headers.subarray(bodyStart));
        headers = null;
      }
    } else {
      res.write(data);
    }
  });
}

module.exports = { forwardGitHttpResponse };
