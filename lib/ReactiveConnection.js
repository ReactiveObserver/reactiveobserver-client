var util=require('util')
//var bullet = require('./bullet.js')
var SockJS = require('sockjs-client')
var promises=require('reactive-promises')
var ko=require('knockout')

function sessionId() {
  var d=Date.now()
  function s4() {
    var t=Date.now()-d
    for(var i=0; i<23; i++) {
      t+=Math.random()*10000
    }
    d=(t^d/4)+(t%101)
    return (Math.floor(t)%10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4();
}

var Connection = function() {

  localStorage.sessionId=localStorage.sessionId || sessionId()

  this.connected=ko.observable(false)
  this.lastRequestId=0
  this.waitingRequests={}

  this.observers={}
  this.contexts={}
  this.messageHandlers={}

  this.autoReconnect=true
}
Connection.prototype.request = function(to,method,args) {
  if(!this.connected) return new promises.FailedPromise('disconnected')
  var futu = new promises.FuturePromise()
  var msg={
      type:'request',
      requestId:(++this.lastRequestId),
      method:method,
      to:to,
      args:args
    }
  this.waitingRequests[msg.requestId]=(function(err,resp){
    if(err) {
      delete this.waitingRequests[msg.requestId]
      return futu.resolveError(err)
    }
    if(resp.type=='error') {
      futu.resolveError(resp)
      return false
    }
    if(resp.type=='progress') {
      futu.notify(resp.progress)
      return 'more'
    }
    futu.resolve(resp)
    return false
  }).bind(this)
  this.send(msg)
  return futu
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
    var context=this.contexts[from[0]]
/*    console.log("HANDLE NOTIFY",from,context,this.contexts)*/
    if(context=='session') from=from.slice(0,1).concat(from.slice(2))

    this.fireObservers(from,message.what,message.signal,message.args)
    return
  }
  var handler=this.messageHandlers[message.type]
  if(handler) handler(message)
}
Connection.prototype.fireObservers = function(from,what,signal,params) {
  var at=JSON.stringify([from,what])
  var observers=this.observers[at]
 // console.log("fireObservers",from,what,at,this.observers,signal,params,observers)
  if(observers) observers.forEach((function(observer){
    process.nextTick(function(){
      observer.apply(observer,[signal].concat(params || []))
    })
  }).bind(this))
}
Connection.prototype.handleDisconnect = function() {
  this.connected(false)
  for(var k in this.waitingRequests) {
    this.waitingRequests[k]('disconnected')
  }
  this.waitingRequests={}
  if(this.autoReconnect) this.initialize()
}
Connection.prototype.observe = function(to, what, observer, context) {
  console.info("observe ",to,what,'@',context)
  this.contexts[to[0]]=context
  var whatId=JSON.stringify([to,what])
  if(!this.observers[whatId]) {
    this.observers[whatId]=[]
    if(this.connected()) this.send({
      type:"observe",
      what:what,
      to:to
    })
  }
  this.observers[whatId].push(observer)
 // console.log("CONNECTION OBSERVERS",this.observers)
}
Connection.prototype.unobserve = function(to,what, observer, context) {
  var whatId=JSON.stringify([to,what])
  var observers=this.observers[whatId]
  if(!observers) throw new Error("Removing non existing observer")
  var index=observers.indexOf(observer)
  if(index==-1) throw new Error("Removing non existing observer")
  observers.splice(index,1)
  if(observers.length==0) {
    delete this.observers[whatId]
    if(this.connected()) this.send({
      type:"unobserve",
      what:what,
      to:to
    })
  }
}
Connection.prototype.handleConnect = function() {
  console.error("HANDLE CONNECT",this)
  this.connected(true)
  this.send({
    type:'initializeSession',
    sessionId:localStorage.sessionId
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
}

/*
var BulletConnection = function(url) {
  Connection.call(this)
  this.url=url
  this.initialize()
}
util.inherits(BulletConnection,Connection)
BulletConnection.prototype.initialize = function() {
  this.connection = bullet(this.url, {})

  this.connection.onopen = (function(){
    this.handleConnect()
  }).bind(this)
  this.connection.onclose = (function(){
    this.handleDisconnect()
  }).bind(this)
  this.connection.onmessage = (function(e){
    console.info("INCOMING MESSAGE", e.data)
    var message=JSON.parse(e.data)
    this.handleMessage(message)
  }).bind(this)
  this.connection.onheartbeat = (function(){
    console.log('BULLET PING!')
    this.send({type:"ping"})
  }).bind(this)
}
BulletConnection.prototype.send = function(message) {
  var data=JSON.stringify(message)
  console.info("OUTGOING MESSAGE", data)
  this.connection.send(data)
}
BulletConnection.prototype.reconnect = function() {
  var ef=function() {}
  this.connection.onclose=ef
  this.connection.onmessage=ef
  this.connection.onheartbeat=ef
  this.connection.onopen=ef
  this.handleDisconnect()
  this.initialize()
}
*/

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

