const _ = require('lodash');
const { readLines } = require('./file');
const { createTunnel } = require('./syscall_sock');
const Queue = require('./queue');
var SocksProxyAgent = require("socks-proxy-agent");
var request = require("request");
const fs = require("fs");

const testSocksPrefix = "socks://localhost:"

const fileName = process.argv[2] || './good_ping.txt';
const initCheckInterval = 5000;
const initSocksCacheCount = 150; // make random tunnel and store result in socksCache
const initSocksCacheTime = 10000; // miliseconds to make init socks cache
const socksCacheTimeout = 4000;
const startPort = process.argv[3] || 9090;
const portCount = process.argv[4] || 20;
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
//socksCache used for initialization
let socksCache = []; //0: target, 1: value, 2: full target
//Sure socks, used when main port failed
// let backupSocks = []; //0: target, 1: full target

const connectionList = readLines(fileName).map((val) => {
  return val.split('|');
});

const failedSocks = readLines("bad_connection.txt");
console.log("init failed socks",failedSocks.length,"sample:",failedSocks[0]);

// function initFailedSocks(){
// 	const failedSocks = readLines("bad_connection.txt");
//   console.log("init failed socks",failedSocks.length,"sample:",failedSocks[0]);
// 	failedSocks.forEach(val =>{
// 		socksCache.push([val,false,""]);
// 	});
// }

// initFailedSocks();

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
  return ind == -1 ? -1 : socksCache[ind][1];
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

function writeFailSocks(options){
  if (options == null || options.target == null) return;
  console.log(">>","writing fail socks",options.target);
  fs.appendFile("bad_connection.txt", options.target + "\n",(e) => {console.log(e)});
}

// remove the sample from list on success or fail
const solved = (data) => {
  smallList.splice(smallList.indexOf(data), 1);
  triggerCount = 0;
};

let pendingSocksCacheCount = 0;

async function logusableSocksCacheCount(){
  let c = 0;
  for (let i = 0; i < socksCache.length; i++) {
    const ele = socksCache[i];
    if (ele[1] == true) c++;
  }
  console.log("Usable sockscache count:",c);
}

const successCache = (options, i = -1) => {
    // console.log("successCache",options.target);
  // storeSocksCache(options, true);
  pendingSocksCacheCount--;
  testSocksHttps(socksCachePort(i),(err,res)=>{
    console.log("a sockcache https test result:", !err, "- current sockscache length:",socksCache.length, "- pending:",pendingSocksCacheCount);
    logusableSocksCacheCount();
    if (!err){
      storeSocksCache(options,true);
    }
  });
};
const failCache = (options, i = -1) => {
    // console.log("FAIL CACHE",options.target);
  // storeSocksCache(options, false);
  failedSocks.push(options.target);
  pendingSocksCacheCount--;
  //writeFailSocks(options);
};

const success = (options, i = -1) => {
  portStatus[i] = true;
  portInfo[i].target = options.target;
  portInfo[i].user = options.user;
  portInfo[i].password = options.password;
  socksProc[i] = options.ssh;
  storeSocksCache(options, true);
  testUnsurePort(i)
  // setTimeout(() => testUnsurePort(i), 1000);
  console.log('-- success count: ', ++successCount);
  solved(options.data);
};

const fail = (options, i = -1) => {
  killPort(i, 'tunnel error');
  portStatus[i] = false;
  ++failCount;
  writeFailSocks(options);
  if (!proxyStarted) createSocks(i);
  storeSocksCache(options, false);
  solved(options.data);
};

const close = (options, i = -1) => {
  if ( i == -1)
    return;
  console.log('closing', i);
  if (proxyStarted == false){
    writeFailSocks(portInfo[i]);  
  }
  portInfo[i].target = '';
  portInfo[i].user = '';
  portInfo[i].password = '';
  if (proxyStarted && portStatus[i] != 2)
    createSocks(i);
  portStatus[i] = 0;
};

function socksCachePort(index){
  return startPort + portCount + index + 23;
}

function buildSocksCache() {
  // socksCache  = []
  const dataList = _.sampleSize(connectionList, initSocksCacheCount);
  let socks = [];
  try{
  const q = new Queue({
    input: dataList,
    concurrency: 200,
    onValue: async (value, index) => {
      try{
      socks[index] = await createTunnel(
        {
          index: index,
          data: value,
          port: socksCachePort(index),
          target: value[0],
          user: value[1],
          password: value[2],
          needLog: false,
					timeout: socksCacheTimeout,
        },
        successCache,
        failCache,
        ()=>{pendingSocksCacheCount--;},
      );
      pendingSocksCacheCount++;
      socks[index] = socks[index].ssh;
    } catch (e){ console.log("buildSockCache err:",value)}
    },
  });
  q.start();
  } catch(e){ console.log('buildSocksCache failed',e)}
  setTimeout(() => {
    //kill all socket process
    for (let i = 0; i < initSocksCacheCount; i++) {
      if (socks[i] == null) continue;
      socks[i].kill();
    }
    pendingSocksCacheCount = 0;
    // console.log(socksCache);
  }, socksCacheTimeout);
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
  if (lastIndex == (socksCache.length - 1)) return -1;
  for (let i = lastIndex; i < socksCache.length; i++) {
		if (socksCache[i] == null || socksCache[i][0] == null) continue;
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
  if (portStatus[index] === true || portStatus[index] > 0) return;
  console.log("Pass port status check");
  let data = null;
  //init used target for port info if not exists
  if (portInfo[index].usedTarget == null) {
    portInfo[index].usedTarget = [];
    portInfo[index].usedTargetCount = 0;
  }
  console.log("Pass init status check");
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
			continue 
		}
    // if (failedSocks.includes(data[0]))
    //   data = null;
  }
  console.log("Pass strong connection");
  portInfo[index].usedTarget[currentIndex] = data[0];
  //delete old tunnel
  portStatus[index] = 2; //close and don't call createSocks
  if (socksProc[index] != null && socksProc[index] != undefined) {
    await killPort(index, 'old tunnel');
  }
  //port is resolving -> don't call create
  portStatus[index] = 1;
  try{
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
  setTimeout(()=>{createSocks(index)},2000)
  // const timeValue = setInterval((interval) => {
  //   createSocks(index);
  //   clearInterval(timeValue);
  // }, 2000);
  } catch (e){ console.log("createSocks error:",e)}
}

var ssh_config = {
  host: "123.16.66.167",
  port: 22,
  username: "admin",
  password: "admin01",
};

async function testSocksHttps(port,callBack){
  var agent = new SocksProxyAgent(testSocksPrefix+port);
  try{
  request(
    {
      url: "https://m.facebook.com/",
      agent,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.87 Safari/537.36",
      },
    },callBack
  );
  } catch(e){
	  console.log("create request to test https failed, port",port,"- detail:",e);
  }
}

async function testUnsurePort(index){
  // var agent = new HTTPAgent(ssh_config);
  // var agent = new SocksProxyAgent("socks://localhost:"+(startPort+index));
  if (portStatus[index] !== true) return;
  const resol = function (err, res) {
    if(err){
      // portStatus[index] = false;
      console.log(err)
      writeFailSocks(portInfo[index]);
      killPort(index,"not accept https");
    }
  }
  testSocksHttps(startPort+index,resol);
}

// async function fillBackupSocks(){
//   while (proxyStarted){
//     for (let i = 0; i < socksCache.length; i++) {
//       const scTarg = socksCache[i][0];
//       const scData = socksCache[i][2];
//       if (element[1] == true){
//         console.log("checking to fill backup socks");
//         socksCache[i][1] = false;
//         testSocksHttps(socksCachePort(i),(err,res)=>{
//           if (!err){
//             backupSocks.push(scData);
//             console.log(scData,"filled to backup socks");
//           }
//         });
//       }
//     }
//   }
// }
let needMaintain = false;

let maintainCount = Array.apply(null, Array(portCount)).map(function () {
  return 0;
});

function maintainPortStatus() {
  //scan port routinely
  // fillBackupSocks();
  const timeValue = setInterval(() => {
    if (!needMaintain) clearInterval(timeValue);

    let failArray = findFailSock();
    console.log('Maintain: ', failArray.length, ' fail sock found.');
    if (failArray.length == 0) {
      proxyStarted = true;
      return;
    }
    if (!needMaintain)
      return;
    failArray.forEach((val, ind) => {
      console.log("recreating",val);
      maintainCount[val]++;
      if (maintainCount[val]==2){
        killPort(val,"fail and timedout");
        maintainCount[val] = 0;
      }
      createSocks(val);
    });
  }, 3000);
  setInterval(()=>{
    buildSocksCache();
    for (let index = 0; index < portStatus.length; index++) {
      testUnsurePort(index);
    }
  },socksCacheTimeout+500)
}

let proxyStarted = false;

function isProxyStarted() {
  return proxyStarted;
}

function killPort(index, reason = 'timed out') {
  if (socksProc[index] == null) return;
  console.log('>> Killing port', index, 'due to', reason);
  //if (proxyStarted == false)
	//  writeFailSocks(portInfo[index]);  
  socksProc[index].kill();
  portStatus[index] = 0;
  console.log(portStatus);
}

function anotherInit() {
  // if (socksCache.length < portCount){
  //   setTimeout(anotherInit, initSocksCacheTime + 100);
  //   buildSocksCache();
  //   return;
  // }
  let failArr = findFailSock();
  if (failArr.length == 0) {
    proxyStarted = true;
    needMaintain = true;
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
    buildSocksCache();
    if (triggerCount == 2) {
      //kill timed out
      console.log("socks cache length:",socksCache.length)
      for (let i = 0; i < portCount; i++) {
        if (portStatus[i] === 1) {
		  writeFailSocks(portInfo[i]);
          killPort(i);
        }
      }
      console.log(portStatus);
      clearInterval(timeValue);
      anotherInit();
      triggerCount = 0;
    }
  }, socksCacheTimeout+500);
}

function startSocksProxy(){
  // initPortArray();
  setTimeout(anotherInit, initSocksCacheTime + 100);
  buildSocksCache();
}

function killAllProcess(callBack) {
  console.log("KILLING ALL PROCESS");
  proxyStarted = false;
  for (let i = 0; i < socksProc.length; i++) {
    if (socksProc[i]) socksProc[i].kill();
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
  buildSocksCache,
  anotherInit,
  killAllProcess,
  findFailSock,
  isProxyStarted,
  getPortStatus,
  killPort,
  createSocks,
  getPortInfo,
  startSocksProxy,
};


if (require.main === module){
  startSocksProxy();
}

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
});
