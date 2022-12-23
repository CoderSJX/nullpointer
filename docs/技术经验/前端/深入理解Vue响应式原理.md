---
date: 2022-03-23
categories:
 - 编程之路
tags:
 - 编程经验
 - 深入理解
 - Vue
 - JavaScript
 - 源码解析
---

## 引入

```vue
<template>
    <div class="hello">
        {{message}}
    </div>
</template>

<script>
export default {
    name: 'HelloWorld',
    props: {
        msg: String
    },
    data() {
        return {
            message: 'Hello'
        }
    },
    mounted() {
        setTimeout(()=>{this.message='Hello World'},2000)
    }
}
</script>
```

这段代码会在2s后更新message的值，而message在页面上也会同步更新。我们并没有直接对DOM进行操作，为什么DOM发生了变化？



## 核心原理

Vue的响应式的核心原理就是ES5的Object.defineProperty方法，这就是为什么Vue不兼容IE8及以下浏览器的原因。

[不兼容原因详解](https://blog.csdn.net/weixin_30772105/article/details/96514136)

### Object.defineProperty

此方法用于在对象上添加或修改一个属性，并返回这个对象。

方法接受三个参数，第一个参数obj表示要操作的对象，第二个参数prop要添加或修改的属性名，第三个参数是该属性的描述符descriptor。

```typescript
/**
 * Adds a property to an object, or modifies attributes of an existing property.
 * @param o Object on which to add or modify the property. This can be a native JavaScript object (that is, a user-defined object or a built in object) or a DOM object.
 * @param p The property name.
 * @param attributes Descriptor for the property. It can be for a data property or an accessor property.
 */
defineProperty(o: any, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): any;
```

比较重要的是第三个参数descriptor，可以在此参数中，为该对象的属性定义getter和setter方法，有了getter和setter方法，这个对象才可能是响应式对象。

举个例子：在dataObj上定义name属性，并书写他的get和set方法。

```js
    let value = '111';
    let dataObj = {}
    Object.defineProperty(dataObj, 'name', {
      get: function () {
        console.log("获取value")
        return value;
      },
      set: function (newValue) {
        console.log("修改value："+newValue)
        value = newValue;
      }
    })
    console.log(dataObj.name);
    dataObj.name='333'
    console.log(dataObj.name)
```

```bash
[HMR] Waiting for update signal from WDS...
HelloWorld.vue?140d:24 获取value
HelloWorld.vue?140d:32 111
HelloWorld.vue?140d:28 修改value：333
HelloWorld.vue?140d:24 获取value
HelloWorld.vue?140d:34 333
```

或者这样写，想要修改属性的值，必须说明writable为true。

才能通过dataObj.name = '333'修改该值，不然会报错。

```js
let dataObj = {}
Object.defineProperty(dataObj, 'name', {
  value: '111',
  writable: true
})
console.log(dataObj.name);//111
dataObj.name = '333'
console.log(dataObj.name)///333
```

### 属性描述符接口

```typescript
interface PropertyDescriptor {
    configurable?: boolean;
    enumerable?: boolean;
    value?: any;
    writable?: boolean;
    get?(): any;
    set?(v: any): void;
}
```



到此，知道Vue就是用这个方法让一个普通对象成为响应式对象。

接下里，我们看看Vue**什么时候把它变成响应式对象**的，以及具体变成响应式对象的**代码长什么样子**，另外还有**哪些细节要处理**。



## 初始化响应式对象

这里我们就要去看Vue的源代码了，感兴趣的把Vue2.x版本的github代码clone下来自己看。

在new Vue的时候，调用的是`src/core/instance/index.js`。

```js
import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

initMixin(Vue)
stateMixin(Vue)
eventsMixin(Vue)
lifecycleMixin(Vue)
renderMixin(Vue)

export default Vue
```

在这里面调用了`initMixin(Vue)`。

这个方法在同目录下的init.js中定义，不用看这个文件里的其他代码，只看它里面调用了`initState(vm)`方法，然后我们在去找这个方法。

```js
export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    vm._isVue = true
    // merge options
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options)
    } else {
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm)
    initEvents(vm)
    initRender(vm)
    callHook(vm, 'beforeCreate')
    initInjections(vm) // resolve injections before data/props
    initState(vm)
    initProvide(vm) // resolve provide after data/props
    callHook(vm, 'created')

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}
```

这个方法在同目录下的state.js中定义。可以看到它调用了`initProps`、`initData()`、`initComputed()`等方法。

```js
export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}
```

我们主要看下initData方法，因为我们经常在data里定义变量，这个方法里的vm.$options.data就是我们在Vue中定义的data。

```js
function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  observe(data, true /* asRootData */)
}
```

>  `The data property "${key}" is already declared as a prop. ` +
>         `Use prop default value instead.`这段话是不是很熟悉？😁，这是我们第一次同时使用data和props的时候，可能会遇到的。如果在props中和data中定义了相同名字的变量，控制台会报这样的错。

可以看到，对于data中每个变量，也就是这里的每个key，都使用了 `proxy(vm, _data, key)`方法，那么我们去看看这个方法。

```js
export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}
```

这方法接收三个参数target，sourceKey，key。

可以看到它调用这个方法时，target是`vm`，sourceKey是`_data`，key传的是当前遍历到的key。

vm就是我们经常用到的，在Vue中用到的this，通常我们在开发中使用data中的变量a，我们用this.a来获取，这个this就是此时的vm。

那么这个proxy方法到底在干什么？别着急，我慢慢讲。

现在target为vm没错，假设我们在Vue data上定义了变量a，那么此时的key就是a。

```vue
<script>
export default {
  name: 'HelloWorld',
  props: {
    msg: String
  },
  data() {
    return {
      a: 'Hello',
    }
  },
}
</script>
```

他在sharedPropertyDefinition上定义了get、set方法，并调用了 `Object.defineProperty(target, key, sharedPropertyDefinition)`，由此，`在vm上定义了属性a，并把a的属性描述符设置成了sharedPropertyDefinition`。

也就是说，现在获取属性a，就是调用sharedPropertyDefinition.get方法。修改属性a，就是调用sharedPropertyDefinition.set方法。

来看get方法，他返回`this[sourceKey][key]`，this就是`vm`，sourceKey就是`_data`，key就是a。

由此，返回了vm[\_data].a，也就是vm上属性\_data中的a。

那么vm[\_data]是啥？在上面的initData方法的开始，有这样的一部分代码。他把我们在Vue中的data赋给了vm.\_data。

```js
let data = vm.$options.data
data = vm._data = typeof data === 'function'
  ? getData(data, vm)
  : data || {}
```

由此，我们可以得知，原先我们在Vue代码中，应该用this.\_data.a来访问我们定义在data中的变量a，现在只需要`this.a`即可访问，因为它会调用sharedPropertyDefinition的get方法，来返回this.\_data.a。set方法同样的道理，可以通过this.a='xxxx'，来修改a的值，而不用通过this.\_data.a='xxxx'。

```vue
<script>
export default {
  name: 'HelloWorld',
  props: {
    msg: String
  },
  data() {
    return {
      a: 'Hello',
    }
  },
  mounted() {
    console.log(this.a)
  }
}
</script>
```

到此为止，我们看到了 `Object.defineProperty`在Vue源码中的位置。

但，利用这个方法只是基础，所谓响应式，应该是页面能感受到该变量的值进行修改了，那么就需要有个人在变量修改之后通知页面。

这个人就是`observer`（观察者）。

可以在initData方法的最后看到这样的代码：`observe(data, true /* asRootData */)`,他调用了observe方法，把data包裹进一个Observer里 `ob = new Observer(value)`。

```js
/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}
```

### Observer

我们看下Observer的定义：为了便于观察，我把数组对象相关的代码删掉了，只留下普通对象相关的代码。可以看到对于data，它调用了walk函数`this.walk(value)`。在walk函数中遍历了data中的所有值，每个都调用了 `defineReactive(obj, keys[i])`方法，由此把data中的每个变量变成了响应式的。我们接下来去看看defineReactive方法干了什么。

>  🤣 def(value, '\__ob\__', this)这个方法为data添加了`__ob__`属性，这就是我们经常在浏览器控制台看到的那个，我之前是挺烦这个东西的，看着挺丑的。

```js
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      if (hasProto) {
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }
}
/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}
```

### 体现响应式原理的地方（defineReactive）

`defineReactive`方法new了个Dep，Dep是单词Dependency（依赖）的缩写。这个Dep是个依赖中心，此时，data中的每个变量都有了一个依赖中心，也就是每个变量都有一个dep。我们去看下Dep里面有什么东西。

```js

/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}
```

Dep里面有个subs，而且还是Watcher类型的数组。subs意为subscribe，订阅者们。

也就是说这个subs会存储所有想要观察该变量的观察者，对于观察者们来讲，他们订阅了该变量。

```js
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
  }

  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  depend () {
    if (Dep.target) {
      Dep.target.addDep(this)
    }
  }

  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}
```

### 观察者什么时候订阅的

上面的内容还没有说完，为了更好的理解，先来看下观察者们什么时候订阅的该变量。

在`lifecycle.js`中的`mountComponent`函数中有这样一段代码：在这里new了一个Watcher，我们去看下Watcher的定义。

```js
  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render()
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  new Watcher(vm, updateComponent, noop, {
    before () {
      if (vm._isMounted && !vm._isDestroyed) {
        callHook(vm, 'beforeUpdate')
      }
    }
  }, true /* isRenderWatcher */)
  hydrating = false
```

### Watcher

watcher的定义比较长，主要说一下几点，注意看下构造器：

**newDeps**：存储的是这个watcher依赖了哪些dep。注意是newDeps，不是Deps，两个区别以后再说。

**构造器中的this.value**调用了this.get函数。this.get函数又调用了pushTarget函数，在pushTarget函数中，把当前这个watcher赋给了全局的Dep.target。注意看下面Dep的定义中，target是个static变量，全局只有一份。

**通过调用**`value = this.getter.call(vm, vm)`方法触发了该watcher**所需要的全部变量的get方法**。（至于为什么触发了，在哪里触发了，不用管，简单解释下，上面的代码中我们new Watcher的时候传入的参数expression为“updateComponent”，是和渲染有关的，渲染用到了哪些变量，所以就都会触发他们的getter）。

我们在**defineReactive**的时候，已经将变量的get和set方法覆盖了，写成了下面这样。`if (Dep.target) dep.depend()`

此时我们知道**当前的Dep.target**就是当前的watcher，然后，调用了该变量的dep的depend()方法。

**dep的depend方法**调用了 `Dep.target.addDep(this)`，也就是当前的watcher调用了addDep，把该dep放进了当前watcher的newDeps里，也就完成了watcher的依赖收集。`this.newDeps.push(dep)`

并且通过`dep.addSub(this)`，将该watcher也放进了该dep的subs里，**完成了该watcher对该dep的订阅**。

```js
export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}
```

```js
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
  }
//.....
}
```

```js
 Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    //.....
 }
```

```js
 depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }
```

```js
  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }
```

```js
/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value)
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
```



## 触发更新

最后我们在来简单看下，数据更新时，发生了什么。

前面我们对每个变量进行defineReactive的时候，编写了它的set方法。

在set方法中，如果变量发生了变化，就调用该变量的dep的notify()。通知该变量的订阅者们，变量发生变化了。

```js
 set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
```

可以看到notify ()方法中，对于该dep的subs（订阅者们），都调用了他们的update方法。

```js
  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
```

可以看到订阅者们（订阅者都是watcher），他们的update方法是将自己放进了一个执行队列里，等待执行。我们去看看这个queueWatcher方法。

```js
/**
 * Subscriber interface.
 * Will be called when a dependency changes.
 */
update () {
  /* istanbul ignore else */
  if (this.lazy) {
    this.dirty = true
  } else if (this.sync) {
    this.run()
  } else {
    queueWatcher(this)
  }
}
```

在同目录下的`scheduler.js`文件中定义了 `queueWatcher`方法。简单来看，在nextTick的时候刷新了队列，也就是把队列里的watcher任务都执行完成了。

```js
/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      nextTick(flushSchedulerQueue)
    }
  }
}
```

至此，响应式原理的基本原理就已经水落石出了。还有其他的细节等后续再更新。