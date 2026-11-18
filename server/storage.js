'use strict';

const fs = require('node:fs');
const path = require('node:path');

const definitions = {
  users: { id: String, email: String, name: String, role: String, passwordSalt: String, passwordHash: String, headline: String, location: String, summary: String, skills: String, company: String, createdAt: String },
  jobs: { id: String, title: String, company: String, location: String, type: String, category: String, salary: String, description: String, requirements: [String], ownerId: String, createdAt: String },
  applications: { id: String, candidateId: String, jobId: String, coverNote: String, status: String, createdAt: String },
  savedJobs: { candidateId: String, jobId: String, createdAt: String },
  sessions: { tokenHash: String, userId: String, expiresAt: Date }
};

const uniqueKeys = {
  users: [['id'], ['email']],
  jobs: [['id']],
  applications: [['id'], ['candidateId', 'jobId']],
  savedJobs: [['candidateId', 'jobId']],
  sessions: [['tokenHash']]
};

function localStorage(file, initialData) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : initialData;
  for (const name of Object.keys(definitions)) data[name] ??= [];
  const matches = (record, query) => Object.entries(query).every(([key, value]) =>
    value && Object.hasOwn(value, '$in') ? value.$in.includes(record[key]) : record[key] === value
  );
  function commit(name, records) {
    const updated = { ...data, [name]: records };
    fs.writeFileSync(file + '.tmp', JSON.stringify(updated, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    data = updated;
  }
  return Object.fromEntries(Object.keys(definitions).map(name => [name, {
    list: (query = {}) => data[name].filter(record => matches(record, query)),
    find: query => data[name].find(record => matches(record, query)),
    insert(record, { ignoreDuplicate = false } = {}) {
      if (data[name].some(existing => uniqueKeys[name].some(keys => keys.every(key => existing[key] === record[key])))) {
        if (ignoreDuplicate) return;
        throw Object.assign(new Error('Duplicate record.'), { code: 11000 });
      }
      commit(name, [record, ...data[name]]);
    },
    update(query, fields) {
      const existing = data[name].find(record => matches(record, query));
      if (!existing) return null;
      const updated = { ...existing, ...fields };
      commit(name, data[name].map(record => record === existing ? updated : record));
      return updated;
    },
    remove(query) {
      const records = data[name].filter(record => !matches(record, query));
      if (records.length !== data[name].length) commit(name, records);
    }
  }]));
}

async function mongoStorage(uri) {
  const mongoose = require('mongoose');
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const collections = {};
  try {
    for (const [name, fields] of Object.entries(definitions)) {
      const schema = new mongoose.Schema(fields, { id: false, versionKey: false });
      for (const keys of uniqueKeys[name]) {
        schema.index(Object.fromEntries(keys.map(key => [key, 1])), { unique: true });
      }
      if (name === 'jobs') schema.index({ ownerId: 1, createdAt: -1 });
      if (name === 'applications') schema.index({ jobId: 1 });
      if (name === 'sessions') schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      const model = connection.model(name, schema, name);
      await model.init();
      collections[name] = {
        list: (query = {}) => model.find(query, { _id: 0 }).sort({ createdAt: -1 }).lean(),
        find: query => model.findOne(query, { _id: 0 }).lean(),
        async insert(record, { ignoreDuplicate = false } = {}) {
          try {
            await model.create(record);
          } catch (error) {
            if (!ignoreDuplicate || error.code !== 11000) throw error;
          }
        },
        update: (query, fields) => model.findOneAndUpdate(query, { $set: fields }, {
          returnDocument: 'after', projection: { _id: 0 }
        }).lean(),
        remove: query => model.deleteOne(query)
      };
    }
    return collections;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

module.exports = { localStorage, mongoStorage };
