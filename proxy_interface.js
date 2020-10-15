const {initSocksCacheTime,anotherInit, killAllProcess, 
    findFailSock, isProxyStarted, getPortStatus, killPort, createSocks, getPortInfo, buildSocksCache,startSocksProxy}
= require('./socks_main');

const express = require('express');
const { createSocket } = require('dgram');
const { stat } = require('fs');
const app = express()
const port = 3000
let startPort = 0;
let portCount = 0;

function resetIndex(portId,obj=null){
    if (portCount == 0){
        let obj = getPortStatus();
        startPort = obj.startPort;
        portCount = obj.portCount;
    }
    if (isProxyStarted() == false){
        return;
    }
    if (portId == 'all'){
        //kill all then init again
        killAllProcess(()=>{
            // setTimeout(anotherInit,initSocksCacheTime);
        });
        return;
    }
    console.log("received kill port: ", portId);
    try{
        let i = parseInt(portId);
        if (i > portCount-1)
            return;
        console.log("killing index", i);
        killPort(i,"request");
    } catch (err){
        console.log(err);
    }

}

app.get('/reset/:portId', (req, res) => {
    let portId = req.params.portId;
    resetIndex(portId);
    res.send('Resetting '+portId);
})

app.get('/reset_port/:port', (req, res) => {
    let portId = req.params.port;
    if (portId != 'all'){
        try{
            portId = parseInt(portId);
        } catch(e){
            
        }
        portId = portId - startPort;
    }
    resetIndex(portId);
    res.send('Resetting');
})

app.get('/info', (req, res) => {
    let obj = getPortInfo();
    res.send(obj.portInfo);
})



app.get('/status/:statusId', (req, res) => {
    let id = req.params.statusId;
    let r = getPortStatus();
    if (id == "all"){
        let obj = {};
        obj.running = isProxyStarted();
        obj.startPort = r.startPort;
        obj.portCount = r.portCount;
        obj.status = r.portStatus;
        res.send(obj);
        return;
    }
    res.send(r.portStatus[id]);
})


app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
    startSocksProxy();
})