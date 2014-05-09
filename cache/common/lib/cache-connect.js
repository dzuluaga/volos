/****************************************************************************
 The MIT License (MIT)

 Copyright (c) 2013 Apigee Corporation

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/
'use strict';

var _ = require('underscore');

function CacheConnect(cache, options) {
  if (!(this instanceof CacheConnect)) {
    return new CacheConnect(cache, options);
  }

  this.internalCache = cache;
  this.options = options || {};
}
module.exports = CacheConnect;

// only caches "GET" requests
// id (optional) may be a string or a function that takes the request and generates a string id
//   if not specified, id will be set to the request originalUrl
CacheConnect.prototype.cache = function(id) {
  var self = this;
  var options = {
    ttl: this.internalCache.options.ttl
  };
  return function(req, resp, next) {

    if (req.method !== 'GET') { return next(); }

    if (_.isFunction(id)) { id = id(req); }
    var key = id ? id : req.originalUrl;
    debug('Cache check');

    var getSetCallback = function(err, reply, fromCache) {
      if (err) { return console.log('Cache error: ' + err); }

      if (reply && fromCache) {
        if (debugEnabled) { debug('cache hit: ' + key); }
        var len = reply.readUInt8(0);
        var contentType = reply.toString('utf8', 1, len + 1);
        var content = reply.toString('utf8', len + 1);
        if (contentType !== '') {
          resp.setHeader('Content-Type', contentType);
        }
        return resp.end(content);
      }
    };

    var populate = function(key, cb) {
      if (debugEnabled) { debug('cache miss: ' + key); }
      var cacheValue, contentType;

      // replace write() to intercept the content sent to the client
      resp._v_write = resp.write;
      resp.write = function (chunk, encoding) {
        resp._v_write(chunk, encoding);
        if (chunk) {
          if (cacheValue) {
            debug('multiple writes, no cache');
            cacheValue = undefined; // multiple writes, don't cache
          } else {
            contentType = resp._headers['content-type'] || '';
            cacheValue = chunk;
          }
        }
      };

      // replace end() to intercept the content returned to the client
      var end = resp.end;
      resp.end = function (chunk, encoding) {
        resp.end = end;
        if (chunk) {
          if (cacheValue) {
            debug('multiple writes, no cache');
            cacheValue = undefined; // multiple writes, don't cache
          } else {
            resp.on('finish', function () {
              contentType = resp._headers['content-type'] || '';
              cacheValue = chunk;
            });
          }
        }
        resp.end(chunk, encoding);

        cache(contentType, cacheValue, cb);
      };
      return next();
    };

    resp.setHeader('Cache-Control', "public, max-age=" + Math.floor(options.ttl / 1000) + ", must-revalidate");
    self.internalCache.getSet(key, populate, options, getSetCallback);
  };
};

function cache(contentType, chunk, cb) {
  var buffer;
  if (chunk) {
    var size = chunk.length + contentType.length + 1;
    buffer = new Buffer(size);
    buffer.writeUInt8(contentType.length.valueOf(), 0);
    buffer.write(contentType, 1);
    if (Buffer.isBuffer(chunk)) {
      chunk.copy(buffer, contentType.length + 1, 0);
    } else {
      buffer.write(chunk, contentType.length + 1);
    }
  }
  cb(null, buffer);
}

var debug;
var debugEnabled;
if (process.env.NODE_DEBUG && /cache/.test(process.env.NODE_DEBUG)) {
  debug = function(x) {
    console.log('Cache: ' + x);
  };
  debugEnabled = true;
} else {
  debug = function() { };
}
