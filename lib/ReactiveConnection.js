var util=require('util')
var SockJS = require('sockjs-client')
var Promise = require('es6-promises')
var EventEmitter = require('events');

function sessionId() {
  var d=Date.now()
  function s4() {
    var t=Date.now()-d
    for(var i=0; i<23; i++) {
      t+=Math.random()*10023
    }
    d=(t^d/4)+(t%101)
    return (Math.floor(t)%610001)
      .toString(16)
      .slice(-4);
  }
  return s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4();
}

var Connection = function() {
  this.sessionId=sessionId()

  try {
    localStorage.sessionId = localStorage.sessionId || this.sessionId
    this.sessionId=localStorage.sessionId
  } catch(e) {

  }

  this.connected=false
  this.lastRequestId=0
  this.waitingRequests={}

  this.observers={}
  this.messageHandlers={}

  this.autoReconnect=true
}
util.inherits(Connection,EventEmitter)
Connection.prototype.sendRequest = function(msg) {
  if(!this.connected) return new Promise(function(resolve,reject){ reject('disconnected') })
  msg.requestId= (++this.lastRequestId)

  var promise=new Promise((function(resolve,reject) {
    this.waitingRequests[msg.requestId]=(function(err,resp){
      if(err) {
        delete this.waitingRequests[msg.requestId]
        return reject(err)
      }
      if(resp.type=='error') {
        reject(resp.error)
        return false
      }
      resolve(resp.response)
      return false
    }).bind(this)
  }).bind(this))

  this.send(msg)
  return promise
}
Connection.prototype.request = function(to,method,args) {
  var msg={
      type:'request',
      method:method,
      to:to,
      args:args
    }
  return this.sendRequest(msg)
}
Connection.prototype.get = function(to,what) {
  var msg={
    type:'get',
    what: what,
    to: to
  }
  return this.sendRequest(msg)
}
Connection.prototype.event = function(to,method,args) {
  this.send({
    type:'event',
    to:to,
    method:method,
    args:args
  })
}
Connection.prototype.reconnect = function() {
  throw new Error("NOT IMPLEMENTED")
}
Connection.prototype.handleMessage = function(message) {
  if (message.type=="pong"){
    console.log("BULLET PONG")
  }
  if (message.responseId) {
    var handler=this.waitingRequests[message.responseId]
    if(handler(null,message)!='more') delete this.waitingRequests[message.responseId]
    return
  }
  if(message.type=="notify") {
    var from=message.from

    this.fireObservers(from,message.what,message.signal,message.args)
    return
  }
  var handler=this.messageHandlers[message.type]
  if(handler) handler(message)
}
Connection.prototype.fireObservers = function(from,what,signal,params) {
  var at=JSON.stringify([from,what])
  var observers=this.observers[at]
  console.log("fireObservers",from,what,at,this.observers,signal,params,observers)
  if(observers) observers.forEach((function(observer){
    process.nextTick(function(){
      observer.apply(observer,[signal].concat(params || []))
    })
  }).bind(this))
}
Connection.prototype.handleDisconnect = function() {
  console.info("REACTIVE OBSERVER DISCONNECTED")
  this.connected=false
  this.emit('disconnected')
  for(var k in this.waitingRequests) {
    this.waitingRequests[k]('disconnected')
  }
  this.waitingRequests={}
  if(this.autoReconnect) {
    setTimeout((function(){
      this.initialize()
    }).bind(this),2323)
  }
}
Connection.prototype.observe = function(to, what, observer) {
  console.info("observe ",to,what)
  var whatId=JSON.stringify([to,what])
  if(!this.observers[whatId]) {
    this.observers[whatId]=[]
    if(this.connected) this.send({
      type:"observe",
      what:what,
      to:to
    })
  }
  this.observers[whatId].push(observer)
 // console.log("CONNECTION OBSERVERS",this.observers)
}
Connection.prototype.unobserve = function(to,what, observer) {
  var whatId=JSON.stringify([to,what])
  var observers=this.observers[whatId]
  if(!observers) throw new Error("Removing non existing observer")
  var index=observers.indexOf(observer)
  if(index==-1) throw new Error("Removing non existing observer")
  observers.splice(index,1)
  if(observers.length==0) {
    delete this.observers[whatId]
    if(this.connected) this.send({
      type:"unobserve",
      what:what,
      to:to
    })
  }
}
Connection.prototype.handleConnect = function() {
  console.info("REACTIVE OBSERVER CONNECTED")
  this.connected=true
  this.send({
    type:'initializeSession',
    sessionId:this.sessionId
  })
  // REFRESH OBSERVABLES!
  for(var whatId in this.observers) {
    var what=JSON.parse(whatId)
    this.send({
      type:"observe",
      what:what[1],
      to:what[0]
    })
  }
  this.emit('connected')
}

 var SockJsConnection = function(url) {
   Connection.call(this)
   this.url=url
   this.initialize()
 }
 util.inherits(SockJsConnection,Connection)
 SockJsConnection.prototype.initialize = function() {
   this.connection = new SockJS(this.url)
   var connection=this.connection
   connection.onopen = (function(){
     if(connection.readyState === SockJS.CONNECTING) return setTimeout(connection.onopen,230)
     this.handleConnect()
   }).bind(this)
   connection.onclose = (function(){
     var ef=function() {}
     connection.onclose=ef
     connection.onmessage=ef
     connection.onheartbeat=ef
     connection.onopen=ef
     this.handleDisconnect()
   }).bind(this)
   this.connection.onmessage = (function(e){
     console.info("INCOMING MESSAGE", e.data)
     var message=JSON.parse(e.data)
     this.handleMessage(message)
   }).bind(this)
/*   this.connection.onheartbeat = (function(){
     console.log('BULLET PING!')
     this.send({type:"ping"})
   }).bind(this)*/
 }
 SockJsConnection.prototype.send = function(message) {
   var data=JSON.stringify(message)
   console.info("OUTGOING MESSAGE", data)
   this.connection.send(data)
 }
 SockJsConnection.prototype.reconnect = function() {
   this.connection.close()
   if(this.autoReconnect) return;
   this.initialize()
 }


module.exports = SockJsConnection

