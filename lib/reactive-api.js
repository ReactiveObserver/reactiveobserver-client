var promises=require('reactive-promises')
var ko=require('knockout')

var Observation=function(fapi,sid,what,context) {
  this.fapi=fapi
  this.sid=sid
  this.what=what
  this.context=context
  this.notifyCb=this.notify.bind(this)

  this.observers=[]

  this.koObservable=null
  this.koObservableArray=null

  this.refCount=0
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
Observation.prototype.addObserver = function(observer) {
  this.observers.push(observer)
  if(this.observers.length==1) this.observe()
}
Observation.prototype.removeObserver = function(observer) {
  this.observers.splice(this.observers.indexOf(observer),1)
  if(this.observers.length==0) this.unobserve()
}
Observation.prototype.toKoObservable = function(observe) {
  if(this.koObservable) return this.koObservable
  this.koObservable=ko.observable()
  var observable=this.koObservable
  var observer=function(signal,data) {
    switch(signal){
      case 'set': observable(data[0]); break
      default: observable.notifySubscribers(observable(),signal)
    }
    observable()
  }
  observable.connected=this.fapi.connected
  if(observe) this.addObserver(observer)
  var observations=observe ? 1 : 0
  if(!observe) {
    observable.beforeSubscriptionAdd=(function() {
      observations++
      if(observations==1) this.addObserver(observer)
    }).bind(this)
    observable.afterSubscriptionRemove=(function(){
      observations--
      if(observations==0) this.removeObserver(observer)
    }).bind(this)
  }

  return observable
}
Observation.prototype.toKoObservableArray = function(observe) {
  if(this.koObservableArray) return this.koObservableArray
  this.koObservableArray=ko.observableArray()
  var observable=this.koObservableArray
  var observer=function(signal,data) {
    //console.error(observable,signal,data)
    switch(signal){
      case 'set': observable(data[0]); break
      case 'pop':
      case "push":
      case "reverse":
      case "shift":
      case "splice":
      case "unshift":
        observable[signal].apply(observable,data)
        break
      case "removeBy":
        observable(observable().filter(function(item) {
          console.log(item,data)
          return JSON.stringify(item[data[0]]) != JSON.stringify(data[1])
        }))
        break
      case "updateBy":
        observable(observable().map(function(item){
          if(JSON.stringify(item[data[0]])==JSON.stringify(data[1])) return data[2]
          return item
        }))
        break
      case "moveBy":
        var d=observable()
        var pos=-1
        for(var i=0; i<d.length; i++) {
          if(JSON.stringify(d[i][data[0]])==JSON.stringify(data[1])) pos=i
        }
        console.log("F",pos)
        if(pos>=0 && pos<d.length) {
          var item=d[pos]
          console.log("!!",pos,data[2],item)
          observable.splice(pos,1)
          observable.splice(data[2],0,item)
        }
        break
      default: observable.notifySubscribers(observable(),signal)
    }
    observable()
  }
  if(observe) this.addObserver(observer)
  var observations=observe ? 1 : 0
  if(!observe) {
    observable.beforeSubscriptionAdd=(function() {
      observations++
      if(observations==1) this.addObserver(observer)
    }).bind(this)
    observable.afterSubscriptionRemove=(function(){
      observations--
      if(observations==0) this.removeObserver(observer)
    }).bind(this)
  }
  return observable
}
Observation.prototype.observe = function() {
  this.fapi.getConnection().observe(this.sid,this.what,this.notifyCb,this.context)
}
Observation.prototype.unobserve = function() {
  this.fapi.getConnection().unobserve(this.sid,this.what,this.notifyCb,this.context)
}
var createObservation=function(fapi,sid,what,context) {
  var cache_id=JSON.stringify([sid,what,context])
  var cached=fapi.observations[cache_id]
  if(!cached) {
    cached=new Observation(fapi,sid,what,context)
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
      api[what]=createObservation(fapi,sid,what,definition.context[0])
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
    var args=Array.prototype.slice.call(arguments,1)
    return createReactiveModuleApi(api.definition[moduleName],["Elixir."+moduleName].concat(args),api)
  }
  api.serverTime=function() {
    return Date.now()
    /// TODO: time synchronization
  }
  api.connection= ko.observable()
  api.getConnection= function() {
    var conn = api.connection()
    if (!conn) throw new Error("no connection attached")
    return conn
  }
  api.connected=ko.computed(function(){
    var conn=api.connection()
    if(!conn) return false
    return conn.connected()
  })
  api.definition=definition
  api.observations={}
  return api
}


module.exports=createReactiveApi