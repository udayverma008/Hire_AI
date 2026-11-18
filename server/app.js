'use strict';

const path = require('node:path');
const express = require('express');

const apiMethods = ['GET', 'POST', 'PATCH', 'DELETE'];
const parseJson = express.json({ limit: '1mb', type: () => true });

function readBody(req) {
  return new Promise((resolve, reject) => {
    parseJson(req, req.res, error => {
      if (error) return reject(error);
      if (Array.isArray(req.body)) {
        return reject(Object.assign(new Error('Request body must be a JSON object.'), { status: 400 }));
      }
      resolve(req.body ?? {});
    });
  });
}

function errorResponse(res, status, error) {
  res.set('Cache-Control', 'no-store').status(status).json({ error });
}

function createApp({ root, handleApi, frontendOrigin }) {
  const app = express();
  app.disable('x-powered-by');
  app.enable('case sensitive routing');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use((req, res, next) => {
    const url = new URL(req.originalUrl, 'http://localhost');
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return next();
    const origin = req.get('Origin');
    const ownOrigin = req.protocol + '://' + req.get('Host');
    res.vary('Origin');
    if (frontendOrigin && origin === frontendOrigin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', apiMethods.join(', '));
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        return res.sendStatus(204);
      }
    }
    if (origin && origin !== ownOrigin && origin !== frontendOrigin && req.method !== 'GET') {
      return errorResponse(res, 403, 'Request origin is not allowed.');
    }
    if (!apiMethods.includes(req.method)) {
      res.set('Allow', apiMethods.join(', '));
      return errorResponse(res, 405, 'Method not allowed.');
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return res.set('Cache-Control', 'no-store').json({ ok: true, service: 'HireAI API' });
    }
    return handleApi(req, res, url);
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    res.set('Allow', 'GET, HEAD');
    return errorResponse(res, 405, 'Method not allowed.');
  });
  app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(root, 'index.html')));
  app.use('/client', express.static(path.join(root, 'client'), { index: false, redirect: false }));
  app.use((req, res) => errorResponse(res, 404, 'Page not found.'));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error(error);
    let message = status >= 500 ? 'Something went wrong.' : error.message;
    if (error.type === 'entity.parse.failed') message = 'Request body must be valid JSON.';
    if (error.type === 'entity.too.large') message = 'Request body is too large.';
    return errorResponse(res, status, message);
  });

  return app;
}

module.exports = { createApp, readBody };
