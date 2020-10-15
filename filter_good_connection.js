const _ = require('lodash');
const { readLines } = require('./file');
const { createTunnel } = require('./syscall_sock');
const Queue = require('./queue');
var SocksProxyAgent = require("socks-proxy-agent");
var request = require("request");


const fileName = process.argv[2] || './good_ping.txt';

const initSocksCacheCount = 200; // make random 100 tunnel and store result in socksCache
const initSocksCacheTime = 5000; // miliseconds to make init socks cache
const startPort = process.argv[3] || 9090;
const portCount = process.argv[4] || 10;
const usedTargetCount = 100; // ensure the port would use n unique ip

//get the port that portStatus[index] is control -> startPort + index
const portStatus = Array.apply(null, Array(portCount)).map(function () {
  return 0;
});
const portInfo = Array.apply(null, Array(portCount)).map(function () {
  return {};
});
const socksProc = Array.apply(null, Array(portCount)).map(function () {
  return null;
});

let socksCache = []; //0: target, 1: value, 2: full target

const connectionList = readLines(fileName).map((val) => {
  return val.split('|');
});

const smallList = _.sampleSize(connectionList, portCount * 10);
console.log(portCount, smallList.length);

let dirtyRange = 0;

let successCount = 0;
let failCount = 0;
let triggerCount = 0;

function findFailSock() {
  let res = [];
  for (let i = 0; i < portStatus.length; i++) {
    if (socksProc[i] && socksProc[i].killed) {
      socksProc[i] = null;
      portStatus[i] = 0;
    }
    if (portStatus[i] !== true) {
      res.push(i);
    }
    testUnsurePort(i);
  }
  return res;
}

function readSocksCache(target) {
  let ind = -1;
  for (let i = 0; i < socksCache.length; i++) {
    if (socksCache[i][0] == target) {
      ind = i;
      break;
    }
  }
  return ind == -1 ? -1 : socksCache[1][ind];
}

function storeSocksCache(options, value) {
  let ind = -1;
  for (let i = 0; i < socksCache.length; i++) {
    if (socksCache[i][0] == options.target) {
      ind = i;
      break;
    }
  }
  if (ind == -1) {
    let tmp = [
      options.target,
      value,
      [options.target, options.user, options.password].join('|'),
    ];
    socksCache.push(tmp);
    ind = socksCache.length - 1;
  }
  socksCache[ind][1] = value;
}

// remove the sample from list on success or fail
const solved = (data) => {
  smallList.splice(smallList.indexOf(data), 1);
  triggerCount = 0;
};

const successCache = (options, i = -1) => {
    // console.log("successCache",options.target);
  storeSocksCache(options, true);
};
const failCache = (options, i = -1) => {
    // console.log("FAIL CACHE",options.target);
  storeSocksCache(options, false);
};

const success = (options, i = -1) => {
  portStatus[i] = true;
  portInfo[i].target = options.target;
  portInfo[i].user = options.user;
  portInfo[i].password = options.password;
  socksProc[i] = options.ssh;
  storeSocksCache(options, true);
  setTimeout(() => testUnsurePort(i), 1000);
  console.log('-- success count: ', ++successCount);
  solved(options.data);
};

const fail = (options, i = -1) => {
  killPort(i, 'tunnel error');
  portStatus[i] = false;
  ++failCount;
  storeSocksCache(options, false);
  solved(options.data);
};

const close = (options, i = -1) => {
  if ( i == -1)
    return;
  console.log('closing', i);
  portStatus[i] = 0;
  portInfo[i].target = '';
  portInfo[i].user = '';
  portInfo[i].password = '';
  createSocks(i);
};

function initSocksCache() {
  const dataList = _.sampleSize(connectionList, initSocksCacheCount);
  let socks = [];
  const q = new Queue({
    input: dataList,
    concurrency: 200,
    onValue: async (value, index) => {
      socks[index] = await createTunnel(
        {
          index: index,
          data: value,
          port: startPort + portCount + index + 23,
          target: value[0],
          user: value[1],
          password: value[2],
          needLog: false,
					timeout: 3000,
        },
        successCache,
        failCache,
        failCache,
      );
      socks[index] = socks[index].ssh;
    },
  });
  q.start();
  setTimeout(() => {
    //kill all socket process
    for (let i = 0; i < initSocksCacheCount; i++) {
      if (socks[i] == null) continue;
      socks[i].kill();
    }
    // console.log(socksCache);
  }, initSocksCacheTime);
}

function uniqueCheck(options, index) {
  let data = options.data;
  //unique among current ports
  for (let i = 0; i < portInfo.length; i++) {
    if (portInfo[i].target == data[0]) {
      return false;
    }
  }
  //unique among used targets
  if (data != null) {
    for (let i = 0; i < portInfo[index].usedTarget.length; i++) {
      if (portInfo[index].usedTarget[i] == data[0]) {
        return false;
      }
    }
  }
  return true;
}
function takeFineSocksCache(lastIndex) {
  if (lastIndex == socksCache.length - 1) return -1;
  for (let i = lastIndex; i < socksCache.length; i++) {
    if (socksCache[i][1] == true) {
      socksCache[i][1] = false;
      return i;
    }
  }
  return -1;
}

function sampleFinestSocks(scIndex) {  
  if (scIndex == -1) return _.sample(connectionList);
//   console.log(scIndex, socksCache);
  return socksCache[scIndex][2].split('|');
}

async function createSocks(index) {
  if (portStatus[index] === true || portStatus[index] === 1) return;
  // console.log("Pass port status check");
  let data = null;
  //init used target for port info if not exists
  if (portInfo[index].usedTarget == null) {
    portInfo[index].usedTarget = [];
    portInfo[index].usedTargetCount = 0;
  }
  // console.log("Pass init status check");
  // index to find used target
  const currentIndex = portInfo[index].usedTargetCount++;
  portInfo[index].usedTargetCount %= usedTargetCount;
  //ensure unique connection
  let lastSCIndex = 0;
  while (data == null) {
    lastSCIndex = takeFineSocksCache(lastSCIndex);
    data = sampleFinestSocks(lastSCIndex);
    if (!uniqueCheck({ data }, index)) {
      data = null;
    }
  }
  // console.log("Pass strong connection");
  portInfo[index].usedTarget[currentIndex] = data[0];
  //delete old tunnel
  if (socksProc[index] != null && socksProc[index] != undefined) {
    await killPort(index, 'old tunnel');
  }
  //port is resolving -> don't call create
  portStatus[index] = 1;
  // make tunnel and store the process of that tunnel
  socksProc[index] = await createTunnel(
    {
      index: index,
      data: data,
      port: startPort + index,
      target: data[0],
      user: data[1],
      password: data[2],
      needLog: true,
			timeout: 3000,
    },
    success,
    fail,
    close,
  );
  socksProc[index] = socksProc[index].ssh;

  //ensure that tunnel is successfully created
  const timeValue = setInterval((interval) => {
    createSocks(index);
    clearInterval(timeValue);
  }, 2000);
}

var ssh_config = {
  host: "123.16.66.167",
  port: 22,
  username: "admin",
  password: "admin01",
};


async function testUnsurePort(index){
  // var agent = new HTTPAgent(ssh_config);
  var agent = new SocksProxyAgent("socks://localhost:"+(startPort+index));
  if (portStatus[index] !== true){
    return;
  }
  request(
    {
      url: "https://m.facebook.com/",
      agent,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.87 Safari/537.36",
      },
    },
    function (err, res) {
      if(err){
        // portStatus[index] = false;
        console.log(err)
        killPort(index,"not accept https");
      }
    }
  );
}

function maintainPortStatus() {
  //scan port routinely
  const timeValue = setInterval(() => {
    if (!proxyStarted) clearInterval(timeValue);

    let failArray = findFailSock();
    console.log('Maintain: ', failArray.length, ' fail sock found.');
    if (failArray.length == 0) {
      return;
    }
    if (!proxyStarted)
      return;
    failArray.forEach((val, ind) => {
      console.log("recreating",val);
      createSocks(val);
    });
  }, 3000);
}

let proxyStarted = false;

function isProxyStarted() {
  return proxyStarted;
}

function killPort(index, reason = 'timed out') {
  if (socksProc[index] == null) return;
  console.log('>> Killing port', index, 'due to', reason);
  socksProc[index].kill();
  portStatus[index] = 0;
  console.log(portStatus);
}

function anotherInit() {
  let failArr = findFailSock();
  if (failArr.length == 0) {
    proxyStarted = true;
    console.log('!!! SERVER INITIALIZED !!!');
    maintainPortStatus();
    return;
  }
  console.log(failArr.length, ' socks not created');

  if (!proxyStarted) {
    for (let i = 0; i < portCount; i++) {
      createSocks(i);
    }
  }
  const timeValue = setInterval((interval) => {
    console.log(successCount, failCount);
    console.log(portStatus);
    console.log("triggerCount:",++triggerCount);
    if (triggerCount == 2) {
      //kill timed out
      for (let i = 0; i < portCount; i++) {
        if (portStatus[i] === 1) {
          killPort(i);
        }
      }
      console.log(portStatus);
      clearInterval(timeValue);
      anotherInit();
      triggerCount = 0;
    }
  }, 5000);
}

// initPortArray();
setTimeout(anotherInit, initSocksCacheTime);
initSocksCache();

function killAllProcess(callBack) {
  console.log("KILLING ALL PROCESS");
  proxyStarted = false;
  for (let i = 0; i < socksProc.length; i++) {
    if (portStatus[i] === true) socksProc[i].kill();
  }
  const timeValue = setInterval((interval) => {
    console.log('killing: ', portStatus);
    if (findFailSock().length == portCount) {
      clearInterval(timeValue);
      callBack();
    }
  }, 1000);
}

function getPortInfo(){
    return ({portInfo});
}

function getPortStatus() {
  return { startPort, portCount, portStatus };
}

module.exports = {
  initSocksCacheTime,
  initSocksCache,
  anotherInit,
  killAllProcess,
  findFailSock,
  isProxyStarted,
  getPortStatus,
  killPort,
  createSocks,
  getPortInfo,
};
