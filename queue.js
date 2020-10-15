function sleep(timeout) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), timeout);
  });
}

function Queue(options = {}) {
  this.concurrency = options.concurrency || 10;
  this.input = options.input;
  this.onValue = options.onValue;
  this.pending = 0;
  this.index = 0;
}

Queue.prototype.exec = async function () {
  const value = this.input.shift();
  this.pending++;
  this.onValue(value, this.index++)
    .then(() => this.pending--)
    .catch(() => this.pending--);
};

Queue.prototype.start = async function () {
  while (this.input.length > 0 || this.pending > 0) {
    const size = Math.min(this.concurrency - this.pending, this.input.length);
    for (let i = 0; i < size; i++) {
      this.exec();
    }
    await sleep(300);
  }
};

module.exports = Queue;