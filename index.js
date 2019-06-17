'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const Url = require('url');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const DEFAULT_TIMEOUT = 5000;
const READ_TIMER = Symbol('TIMER::READ_TIMER');
const READ_TIME_OUT = Symbol('TIMER::READ_TIME_OUT');

function isIntegerAndGtZero(number) {
  return Number.isInteger(number) && number > 0;
}

function append(err, name, message) {
  err.name = name + err.name;
  err.message = `${message}. ${err.message}`;
  return err;
};

exports.request = (url, opts = {}) => {
  let responseTimeout, connectTimeout;
  responseTimeout = isIntegerAndGteZeor(opts.responseTimeout) ? opts.responseTimeout : DEFAULT_TIMEOUT;
  connectTimeout = isIntegerAndGtZero(opts.connectTimeout) ? opts.connectTimeout : DEFAULT_TIMEOUT;

  const urlObj = typeof url === 'string' ? Url.parse(url) : url;

  const isHttps = urlObj.protocol === 'https:';
  const method = (opts.method || 'get').toUpperCase();
  const agent = opts.agent || (isHttps ? httpsAgent : httpAgent);

  const options = {
    host: urlObj.hostname || 'localhost',
    path: urlObj.path || '',
    method,
    port: urlObj.port || (isHttps ? '443' : '80'),
    agent,
    headers: opts.headers || {},
    timeout: connectTimeout
  }

  if (isHttps && typeof opts.rejectUnauthorized !== undefined) {
    options.rejectUnauthorized = opts.rejectUnauthorized;
  }

  if (opts.compression) {
    options.headers['accept-encoding'] = 'gzip,deflate';
  }

  const httplib = isHttps ? https : http;

  if (typeof opts.beforeRequest === 'function') {
    options = opts.beforeRequest(options);
  }

  return new Promise((resolve, reject) => {
    const request = httplib.request(options);
    const body = opts.data;

    const fulfilled = response => {
      resolve(response);
    };

    const rejected = err => {
      err.message += `${method} ${Url.format(urlObj)} failed.`;
      // clear response timer when error
      if (request.socket[READ_TIMER]) {
        clearTimeout(request.socket[READ_TIMER]);
      }
      reject(err);
    };

    const abort = err => {
      request.abort();
      rejected(err);
    };

    const startResponseTimer = socket => {
      const timer = setTimeout(() => {
        if (socket[READ_TIMER]) {
          clearTimeout(socket[READ_TIMER]);
          socket[READ_TIMER] = null;
        }
        var err = new Error();
        var message = `ResponseTimeout(${responseTimeout})`;
        abort(append(err, 'RequestTimeout', message));
      }, responseTimeout);
      timer.startTime = Date.now();
      // start read-timer
      socket[READ_TIME_OUT] = responseTimeout;
      socket[READ_TIMER] = timer;
    };

    if (!body || 'string' === typeof body || body instanceof Buffer) {
      request.end(body); 
    } else if (typeof body.pipe === 'function') {
      body.pipe(request);
      body.once(error, err => {
        abort(append(err, 'HttpW', 'Stream cause error'));
      })
    }

    request.on('response', fulfilled);
    request.on('error', rejected);
    request.once('socket', socket => {
      if (socket.readyState === 'opening') {
        socket.once('connect', () => {
          startResponseTimer(socket);
        })
      } else {
        startResponseTimer(socket)
      }
    });
  });
}