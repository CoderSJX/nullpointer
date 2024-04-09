
## 闭包

### 定义

闭包：引用了其他函数的函数作用域中变量的函数。

:::tip 
闭包是函数，在函数中引用了其他函数的函数作用域中变量。
:::
举例：

createComparsionFunction函数中返回的匿名函数就是一个闭包，因为它引用了createComparsionFunction函数作用域中的propertyName变量。

```java
    function createComparsionFunction(propertyName) {
        return function (object1, object2) {
            let value1 = object1[propertyName];
            let value2 = object2[propertyName];
            if (value1 < value2) { return -1 }
            else if (value1 > value2) {
                return 1;
            } else {
                return 0;
            }
        }
    }
```



### 特殊情况

下面这种情况不是闭包，虽然在createComparsionFunction函数上声明了变量x，并且在test函数中引用了该变量，但是x变量并不属于createComparsionFunction函数内的变量，因此不是闭包。所以，通常闭包只会在嵌套函数中。

```js
    function createComparsionFunction(propertyName) {
        let b = 234;
    }
    createComparsionFunction.x = 1;
    function test(createComparsionFunction) {
       let y= createComparsionFunction.x
    }
    test(createComparsionFunction)
```



## Promise（期约）

```js
let syncResolve;
let p = new Promise((resolve => {
    syncResolve = function () {
        console.log('resolve started')
        resolve();
        console.log("resolve ended")
    }
}), console.log("with promise"));
console.log("after new promise")
p.then(() => console.log('then handler returns'));
syncResolve();
console.log("after syncResolve ")

//with promise
//after new promise
//resolve started
//resolve ended
//after syncResolve 
//then handler returns
```

1. 伴随new Promise的函数会同步执行。
2. 在Promise变为resolve时，会将resolve的处理程序放进执行任务队列里，其他同步代码照常先执行完毕
3. 同步代码执行完毕后，才会执行任务队列里的函数。



```js
let p = new Promise((resolve, reject) => {
    console.log(123)
    reject('2')
});
p.
then((value => console.log(value))).
catch(value => console.log(value)).
finally(() => {
    console.log("finally")
})
```

then在promise返回resolve时调用，catch在promise返回reject时调用，这两个都可以带参数，finally是不管是resolve还是reject都会调用。

可以在new Promise的时候就调用resolve，生成一个已经resolve的Promise。



```js
let p = new Promise((resolve, reject) => {
    setTimeout(reject, 3000)
});
p.catch(()=>{
    console.log("rejected")
})
```

可以设置超时之后自动进行reject或resolve。



### Promise连锁

实现异步任务串行化

```js
let p1 = new Promise((resolve, reject) => {
    console.log("p1 executor")
    setTimeout(resolve, 1000)
});
p1.then(() => {
    new Promise((resolve, reject) => {
        console.log("p2 executor")
        setTimeout(resolve, 1000)
    }).then(() => {
        new Promise((resolve, reject) => {
            console.log("p3 executor")
            setTimeout(resolve, 1000)
        }).then(() => {
            new Promise((resolve, reject) => {
                console.log("p4 executor")
                setTimeout(resolve, 1000)
            })
        })
    })
})
//注意then的位置，是在每个new后面
//打印结果：每隔一秒打印一个executor
```

把生成Promise的代码提取到一个工厂函数中，解决回调地狱问题。

```js
function delay(message) {
    return new Promise(((resolve, reject) => {
        console.log(message);
        setTimeout(resolve, 1000);
    }))
}

delay("p1 executor")
    .then(() => delay("p2 executor"))
    .then(() => delay("p3 executor"))
    .then(() => delay("p4 executor"))
```

因为then、catch、finally都返回Promise，因此可以串联起来。

```js
let p = new Promise((resolve, reject) => {
    console.log(123)
    reject('2')
});
p.
then((value => console.log(value))).
catch(value => console.log(value)).
finally(() => {
    console.log("finally")
})
```



### Promise.all()和Promise.race()

1. Promise.all()会返回一个新的Promise，这个Promise只有在其包含的所有期约都被解决之后才能解决。
2. 可迭代的对象中的元素会自动调用Promise.resolve()转化成一个Promise
3. 只有在p.then的回调函数中打印p才会打印出fulfilled，而在then之后打印只会打印pending。

```
let p = Promise.all([Promise.resolve(),2,3])
p.then(() => {
    console.log(p);
})
```

```javascript
Promise {<fulfilled>: Array(3)}
[[Prototype]]: Promise
[[PromiseState]]: "fulfilled"
[[PromiseResult]]: Array(3)
```

如果Promise.all()中有Promise被reject，那么按照书写顺序的第一个Promise的reject理由才会成为p的reject理由。之后所有reject的Promise的理由都无效，但是每个reject的情况都会被正常处理，静默处理。、



Promise.race()有所不同，它返回一个Promise，这个Promise是一个镜像Promise，镜像的对象是它包含的Promise中的一个。

通过race这个方法名称可以看出，包含的Promise中谁最快，就返回谁的镜像。

这个快，是指：第一个落定的期约（不论是reject的，还是resolve的），只要是第一个落定状态的。



### 通用的合成期约函数

```js
function addTwo(x) {
    return x + 2;
}

function addThree(x) {
    return x + 3;
}

function addFive(x) {
    return x + 5;
}

// function addTen(x) {
//     return Promise.resolve(x).then(addTwo).then(addThree).then(addFive);
// }

// addTen(10).then(console.log);

// function addTen2(x) {
//     return [addTwo, addThree, addFive]
//         .reduce((promise, fn) => promise.then(fn), Promise.resolve(x))
// }

function compose(...fns) {
    return (x) => fns.reduce((promise, fn) => promise.then(fn), Promise.resolve(x))
}

let addTen = compose(addTwo, addThree, addFive)
addTen(11).then(console.log)
```



## 手写一个数据绑定

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
<input id="input" type="text"/>
<div id="text"></div>
</body>
<script>
    let input = document.getElementById("input");
    let text = document.getElementById("text");
    let data = {value: ""};
    Object.defineProperty(data, "value", {
        set: function (val) {
            text.innerHTML = val;
            input.value = val;
        },
        get: function () {
            return input.value;
        }
    });
    input.onkeyup = function (e) {
        data.value = e.target.value;
    };
</script>
</html>
```











## 发布订阅模式

```html
</html>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    输入框1. <input class="box_1" v-model="input1"></input>
    输入框2. <input class="box_2" v-model="input2"></input>
</body>
<script>
    let subscribeSystem = {
        messagesMap: {},
        register: function (registerId, message) {
            (this.messagesMap[registerId] || (this.messagesMap[registerId] = [])).push(message)
        },
        publish: function () {
            let registerId = Array.prototype.shift.call(arguments)
            let messages = this.messagesMap[registerId]
            if (!messages || messages.length === 0) return;
            for (let i = 0; i < messages.length; i++) {
                let m = messages[i];
                m.apply(this, arguments);
            }
        }
    }
    let data = {
        input1: {
            target: '.box_1',
            content: '内容1'
        },
        input2: {
            target: '.box_2',
            content: '内容2'
        },
    }

    let virtualData = {

    }
    function register({ data }) {
        for (const obj in data) {
            if (Object.hasOwnProperty.call(data, obj)) {
                const ele = data[obj];
                let el = document.querySelector(ele.target);
                el.value=ele.content
                let model = el.value;
                Object.defineProperty(virtualData, obj,
                    {
                        get: function () {
                            return model;
                        },
                        set:function(val){
                            model=val
                            subscribeSystem.publish(obj,val)
                        },

                    }
                )
                subscribeSystem.register(obj,function(content){
                    el.value=content
                })
            }
        }
    }
    register({data})
</script>

</html>
```



