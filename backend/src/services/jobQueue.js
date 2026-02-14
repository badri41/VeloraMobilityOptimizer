const fs = require('fs');
const path = require('path');

const JOBS_DIR = path.join(__dirname, '../../jobs');

// In-memory job store (with file persistence)
const jobs = new Map();

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

// Create a new job
function createJob(jobId, inputPath, isTestCase = false) {
  const job = {
    id: jobId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    inputPath,
    isTestCase,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null
  };

  jobs.set(jobId, job);
  persistJob(job);

  return job;
}

// Get job by ID
function getJob(jobId) {
  if (jobs.has(jobId)) {
    return jobs.get(jobId);
  }

  // Try to load from file
  const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
  if (fs.existsSync(jobFile)) {
    try {
      const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
      jobs.set(jobId, job);
      return job;
    } catch (e) {
      console.error('Error loading job:', e);
    }
  }

  return null;
}

// Update job
function updateJob(jobId, updates) {
  const job = getJob(jobId);
  if (!job) return null;

  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobs.set(jobId, job);
  persistJob(job);

  return job;
}

// Persist job to file
function persistJob(job) {
  const jobFile = path.join(JOBS_DIR, `${job.id}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
}

// List all jobs
function listJobs() {
  return Array.from(jobs.values()).sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
}

// Clean old jobs (older than 1 hour)
function cleanOldJobs() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const [jobId, job] of jobs.entries()) {
    if (new Date(job.createdAt).getTime() < oneHourAgo) {
      jobs.delete(jobId);
      const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
      if (fs.existsSync(jobFile)) {
        fs.unlinkSync(jobFile);
      }
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanOldJobs, 10 * 60 * 1000);

module.exports = {
  createJob,
  getJob,
  updateJob,
  listJobs
};
