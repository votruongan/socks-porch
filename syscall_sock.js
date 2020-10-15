const { spawn } = require('child_process');
const fs = require("fs");
const { resolve } = require('path');

const OS_ON_WINDOWS = process.platform === "win32";

const BAD_CONNECTION_FILE = "./bad_connection.txt";
const GOOD_CONNECTION_FILE = "./good_connection.txt";

function tagString(listenPort, targetHost){
  return ">>> localhost:" + listenPort + " -> " + targetHost;
}

function dataIncludes(data,arr){
  for (let i = 0; i < arr.length; i++) {
    if (data.includes(arr[i]))
      return true;
  }
  return false;
}

function responseTemplate(options, data, condition, response = '\n'){
  if (dataIncludes(data,condition)){
    try{
      options.ssh.stdin.write(response);
    } catch (e){
      console.log("WRITE ERROR: error write EPIPE, ",data.toString('utf-8'),condition,response);
    }
  }
}
function processData(options, sCallback=null,fCallback=null){
  const data = options.data;
  let arr = ['Using username','Permanently added','Reusing']
  if (dataIncludes(data,arr)){
    if (options.needLog)
      console.log(`${tagString(options.port,options.url)} TUNNEL CREATED`);
    fs.appendFileSync(GOOD_CONNECTION_FILE, [options.target,options.user,options.password].join("|") + "\n");
    sCallback(options,options.index);
    return;
  }
  arr = ['FATAL ERROR','timed out','denied']
  if (dataIncludes(data,arr)){
    fs.appendFileSync(BAD_CONNECTION_FILE, options.target + "\n");
    fCallback(options,options.index);
    return "error";
  }
  if (!options.ssh || !options.ssh.stdin || options.ssh.stdin.destroyed)
    return;
  responseTemplate(options,data,["(y/n)"],'y\n');
  responseTemplate(options,data,["yes","no"],'yes\n');
  arr = ['Press Return','prompts']
  responseTemplate(options,data,arr,'\n');
  responseTemplate(options,data,['password'],options.password +'\n');
  return "";
}

async function createTunnel(options, successCallback, failCallback, closeCallback){
  const url = options.user + "@" + options.target;
  const cmd = (OS_ON_WINDOWS)?('plink'):('sshpass');
  let pubPort = "0.0.0.0:" + options.port;
  let args = (OS_ON_WINDOWS)?(["-ssh","-pw",options.password,'-N', '-D',pubPort,url]):
              (['-p',options.password,'ssh','-v','-N', '-D',pubPort,url]);
  const ssh = spawn(cmd, args);
  if (options.needLog)
    console.log("called ", tagString(options.port,url));
  options.url = url;

  ssh.stdout.on('data', (data) => {
    options.data = data;
    options.stream = "Out";
    options.ssh = ssh;
    const res = processData(options,successCallback,failCallback);
  });
  ssh.stderr.on('data', (data) => {
    options.data = data;
    options.stream = "Err";
    options.ssh = ssh;
    const res = processData(options,successCallback,failCallback);
  });
  ssh.on('error', (code) => {
	  console.log('ssh error: ',code);
  });
  ssh.on('close', (code) => {
    if (code == null)
      return;
    if (options.needLog)
      console.log(`${tagString(options.port,url)} exited with code ${code}`);
    closeCallback(options,options.index);
  });


  if (options.timeOut > 0){
    if (options.needLog)
      console.log("TIMEDOUT: ", options.timeOut);
    setTimeout(()=>{ssh.kill()},options.timeOut);
  }
  return ({ssh});
} 

if (require.main === module) {
  createTunnel({
    port: 9090,
    target: '14.186.52.64',
    user:'admin',
    password:'admin'
  });
}

module.exports = {createTunnel};