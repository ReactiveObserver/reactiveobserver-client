var ko = require('knockout')

var phaseSettings = {
  'initializing':{
    pingDelay: 100,
    pingCount: 3,
    nextPhase:'gathering'
  },
  'gathering':{
    pingDelay:1000,
    pingCount:3,
    nextPhase:'working'
  },
  'working':{
    pingDelay:20000,
    pingCount: +Infinity
  }
}

var acceptablePing = 2300
var maxHistorySize = 23

var TimeSync = function(connection,settings) {
  this.connection=connection
  this.settings=settings || {
    phases:phaseSettings,
    acceptablePing: acceptablePing,
    maxHistorySize: maxHistorySize
  }
  this.started=false
  this.pingHistory = []
  this.phase = 'initializing'
  this.phaseObservable = ko.observable()
  this.timeDiffObservable = ko.observable(0)
  this.timeDiff = 0
  this.timeoutFunc = this.timeout.bind(this)
  this.handleFunc= this.handleSyncPong.bind(this)
  this.pingCounter = 0
  this.lastPingTS=0
  this.lastPongTS=0

  this.connection.connected.subscribe((function(state){
    this.pingHistory=[]
    this.lastPingTS=0
    this.lastPongTS=0
  }).bind(this))
}
TimeSync.prototype.start = function() {
  this.phase='initializing'
  this.phaseObservable(this.phase)
  this.timeDiff = 0
  this.timeDiffObservable(this.timeDiff)
  this.started=true
  this.connection.messageHandlers['timeSync']=this.handleFunc
  this.timeoutFunc()
}
TimeSync.prototype.stop = function() {
  this.started=false
  delete this.connection.messageHandlers['timeSync']

}
TimeSync.prototype.handleSyncPong = function(msg) {
  var ts=Date.now()
  this.lastPongTS=ts
  var ping=ts-msg.client_send_ts
  var halfPing=ping/2
  var serverTime=msg.server_recv_ts+halfPing
  var pongData = {
    sendTS: msg.client_send_ts,
    recvTS: ts,
    serverTS: serverTime,
    ping: ping,
    timeDiff: serverTime-ts
  }
  this.pingHistory.push(pongData)
  if(this.pingHistory.length>this.settings.maxHistorySize) this.pingHistory.shift()
  this.calculateStatistics()
}
TimeSync.prototype.calculateStatistics = function() {
  var historySize=this.pingHistory.length
  var pingSum=0
  var pingMax=0
  var pingMin=+Infinity
  for(var i=0; i<historySize; i++) {
    var ping=this.pingHistory[i].ping
    pingSum+=ping
    pingMax=Math.max(pingMax,ping)
    pingMin=Math.min(pingMin,ping)
  }
  var pingAvg=pingSum/historySize
  var timeDiffSum=0
  var timeDiffCount=0
  for(var i=0; i<historySize; i++) {
    var ph=this.pingHistory[i]
    if(ph.ping<=pingAvg) {
      timeDiffCount++
      timeDiffSum+=ph.timeDiff
    }
  }
  var timeDiffAvg=timeDiffSum/timeDiffCount

  if(this.phase=='working') console.info("Time Synchronization Stats: timeDiff = "+timeDiffAvg+"  pingAvg = "+pingAvg+
    "  pingMax = "+pingMax+"  pingMin = "+pingMin)

  this.timeDiff=timeDiffAvg
}
TimeSync.prototype.sendSyncPing = function() {
  this.lastPingTS=Date.now()
  this.connection.send({
    type:"timeSync",
    client_send_ts:Date.now()
  })
}
TimeSync.prototype.timeout = function() {
  if(!this.started) return;
  var phs = this.settings.phases[this.phase]
 // console.error("TIMESYNC",this.connection.connected())
  if(this.connection.connected()) {
    if(this.lastPingTS-this.lastPongTS>this.settings.acceptablePing) { /// CONNECTION TIMEOUT
      this.connection.reconnect()
      this.phase='initializing'
      this.phaseObservable(this.phase)
    }

    this.sendSyncPing()
    this.pingCounter++

//    console.error(this.settings.phases,this.phase)

    if (phs.pingCount < this.pingCounter) {
      this.phase = phs.nextPhase
      this.phaseObservable(this.phase)
      phs = this.settings.phases[this.phase]
    }
  }
  setTimeout(this.timeoutFunc,phs.pingDelay)
}
TimeSync.prototype.serverToLocal = function(ts) {
  return ts+this.timeDiff
}
TimeSync.prototype.localToServer = function(ts) {
  return ts-this.timeDiff
}

module.exports = TimeSync