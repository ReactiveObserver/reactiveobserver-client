var promises=require('reactive-promises')

var Observation=function(fapi,sid,what) {
  this.fapi=fapi
  this.sid=sid
  this.what=what
  this.notifyCb=this.notify.bind(this)

  this.observers=[]

  this.refCount=0
}
Observation.prototype.get = function() {
  return this.fapi.getConnection().get(this.sid,this.what)
}
Observation.prototype.notify = function(signal) {
  var args=Array.prototype.slice.call(arguments,1)
  this.observers.forEach(function(observer) {
    observer(signal,args)
  })
}
Observation.prototype.dispose = function() {
  this.refCount--
  if(this.refCount<=0) {
    if(this.observers.length>0) this.unobserve()
    delete this.fapi.observations[this.cache_id]
  }
}
Observation.prototype.get = function() {
  return this.fapi.getConnection().get(this.sid,this.what)
}
Observation.prototype.addObserver = function(observer) {
  this.observers.push(observer)
  if(this.observers.length==1) this.observe()
}
Observation.prototype.removeObserver = function(observer) {
  this.observers.splice(this.observers.indexOf(observer),1)
  if(this.observers.length==0) this.unobserve()
}
Observation.prototype.observe = function() {
  this.fapi.getConnection().observe(this.sid,this.what,this.notifyCb)
}
Observation.prototype.unobserve = function() {
  this.fapi.getConnection().unobserve(this.sid,this.what,this.notifyCb)
}
var createObservation=function(fapi,sid,what) {
  var cache_id=JSON.stringify([sid,what])
  var cached=fapi.observations[cache_id]
  if(!cached) {
    cached=new Observation(fapi,sid,what)
    cached.cache_id=cache_id
    fapi.observations[cache_id]=cached
  }
  cached.refCount++
  return cached
}

var createReactiveModuleApi = function(definition,sid,fapi) {
  var api={}
  api.api=fapi
  api.definition=definition
  api.observations=[]
  if(definition.observation) {
    definition.observation.forEach(function(what){
      api[what]=createObservation(fapi,sid,what)
      api.observations.push(api[what])
    })
  }
  if(definition.request) {
    definition.request.forEach(function(method){
      api[method]=function() {
        var args=Array.prototype.slice.call(arguments)
        return fapi.getConnection().request(sid,method,args)
      }
    })
  }
  if(definition.request_call) {
    definition.request_call.forEach(function(method){
      api[method]=function() {
        var args=Array.prototype.slice.call(arguments)
        return fapi.getConnection().request(sid,method,args)
      }
    })
  }
  if(definition.event) {
    definition.event.forEach(function(method){
      api[method]=function() {
        var args=Array.prototype.slice.call(arguments)
        fapi.getConnection().event(sid,method,args)
      }
    })
  }

  api.dispose=function() {
    api.observations.forEach(function(o){
      o.dispose()
    })
  }

  return api
}

var createReactiveApi = function(definition) {
  var api=function(moduleName) {
    var n=moduleName
    var a=n
    var args=Array.prototype.slice.call(arguments,1)
    if(!api.definition[a]) throw new Error("Not found API definition for "+JSON.stringify(a))
    return createReactiveModuleApi(api.definition[a],[n].concat(args),api)
  }
  api.serverTime=function() {
    return Date.now()
    /// TODO: time synchronization
  }
  api.connection= null
  api.getConnection= function() {
    var conn = api.connection
    if (!conn) throw new Error("no connection attached")
    return conn
  }
  api.definition=definition
  api.observations={}
  return api
}



exports.createReactiveApi=createReactiveApi
exports.Observation = Observation
