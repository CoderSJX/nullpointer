## （转载）深入理解kubernetes（k8s）网络原理之三-跨主机pod连接

在之前的两篇文章中分别介绍了pod与主机连接并且上外网的原理及service的clusterIP和nodeport的实现原理，对于组织pod的网络这件事来说，还有最后一环需要打通，就是分布在不同集群节点的pod之间如何相互通信，本章我们来解决这最后一环的问题

> 在这里我们继续用linux network namespace(ns)代表pod

我们将用下面三种方式实现跨主机的pod通信：

1. 主机路由
2. ip tunnel
3. vxlan

我准备了两台节点：

- host1（ip:10.57.4.20）
- host2（ip:10.57.4.21）

先在两台节点中分别创建一个pod，并与节点能相互通信，创建pod并与节点通信的相关原理在第一章已经介绍过，这里不再一一解释，直接上命令：

- host1中创建pod-a（ip:192.168.10.10）

```bash
# 创建名为pod-a的网络命名空间
ip netns add pod-a

# 创建一对veth对等接口，一端为eth0，另一端为veth-pod-a
ip link add eth0 type veth peer name veth-pod-a

# 将eth0接口移动到名为pod-a的网络命名空间中
ip link set eth0 netns pod-a

# 在pod-a网络命名空间内配置eth0接口的IP地址和子网掩码
ip netns exec pod-a ip addr add 192.168.10.10/24 dev eth0

# 在pod-a网络命名空间内启动eth0接口
ip netns exec pod-a ip link set eth0 up

# 在pod-a网络命名空间内设置默认路由，通过169.254.10.24网关访问外部网络，并且指定为onlink（直接连接）
ip netns exec pod-a ip route add default via 169.254.10.24 dev eth0 onlink

# 启动veth-pod-a接口
ip link set veth-pod-a up

# 开启veth-pod-a接口上的ARP代理功能
echo 1 > /proc/sys/net/ipv4/conf/veth-pod-a/proxy_arp

# 开启系统的IP转发功能
echo 1 > /proc/sys/net/ipv4/ip_forward

# 添加iptables规则，允许来自192.168.0.0/16子网的数据包在该子网内部进行转发
iptables -I FORWARD -s 192.168.0.0/16 -d 192.168.0.0/16 -j ACCEPT

# 添加主机路由条目，将目的地址为192.168.10.10的数据包通过veth-pod-a接口转发
ip route add 192.168.10.10 dev veth-pod-a scope link
```

- host2上创建pod-b（ip:192.168.11.10）

```bash
# 创建名为pod-b的网络命名空间
ip netns add pod-b

# 创建一对veth对等接口，一端为eth0，另一端为veth-pod-b
ip link add eth0 type veth peer name veth-pod-b

# 将eth0接口移动到名为pod-b的网络命名空间中
ip link set eth0 netns pod-b

# 在pod-b网络命名空间内配置eth0接口的IP地址和子网掩码
ip netns exec pod-b ip addr add 192.168.11.10/24 dev eth0

# 在pod-b网络命名空间内启动eth0接口
ip netns exec pod-b ip link set eth0 up

# 在pod-b网络命名空间内设置默认路由，通过169.254.10.24网关访问外部网络，并且指定为onlink（直接连接）
ip netns exec pod-b ip route add default via 169.254.10.24 dev eth0 onlink

# 启动veth-pod-b接口
ip link set veth-pod-b up

# 开启veth-pod-b接口上的ARP代理功能
echo 1 > /proc/sys/net/ipv4/conf/veth-pod-b/proxy_arp

# 开启系统的IP转发功能
echo 1 > /proc/sys/net/ipv4/ip_forward

# 添加iptables规则，允许来自192.168.0.0/16子网的数据包在该子网内部进行转发
iptables -I FORWARD -s 192.168.0.0/16 -d 192.168.0.0/16 -j ACCEPT

# 添加主机路由条目，将目的地址为192.168.11.10的数据包通过veth-pod-b接口转发
ip route add 192.168.11.10 dev veth-pod-b scope link
```

如无意外，host1应该能ping通pod-a，host2也能ping通pod-b了，环境准备完成，下面我们介绍主机路由模式，这是flannel的host-gw模式的原理。

## 主机路由

其实每一台linux主机本身就是一台路由器，可以用ip route命令配置主机上的路由表，要让pod-a和pod-b相互通信，只需要在两台主机上加一条路由即可：

- host1:

```bash
ip route add 192.168.11.0/24 via 10.57.4.21 dev eth0 onlink # 这个eth0是host1连接host2的网卡，要根据你的测试节点的情况调整
```

- host2:

```bash
ip route add 192.168.10.0/24 via 10.57.4.20 dev eth0 onlink # 这个eth0是host2连接host1的网卡，要根据你的测试节点的情况调整
```

> 注意上面我们加的路由是针对24位网络地址相同的子网段的，一般来说k8s集群的每个节点会独占一个24位的网络地址的子网段，所以每增加一个集群节点，其它节点加一条路由就可以了，但如果不是这样设计，像之前提过的pod要固定IP，又想要能在整个集群的任意节点运行，这个主机路由条目就会比较多，因为每条路由都是针对单个pod的

此时在pod-a中去ping pod-b应该是通了的，假设在pod-b的8080端口运行着一个http服务，在pod-a中请求这个服务，在主机路由的模式下，host1发往host2的数据包是长这样的：

![img](https://cdn.jsdelivr.net/gh/CoderSJX/nullpointer-images/images/202404201058862.webp)

图一：主机路由

注意图中的源IP和目标IP是容器的，但MAC地址却是主机的，我们在第一章中提到的linux网络知识的发送包的第5点说起过，数据包发送过程中，除非经过NAT，否则IP不会变化，始终标明通信双方，但MAC地址是每一段都会变化，数据包从pod-a到pod-b一共会经历三段：

1. 从pod-a发往host1时，源mac是pod-a的eth0网卡的mac，而目标mac是pod-a的默认网关（169.254.10.24）的mac，因为主机的veth-pod-a开启了arp代答，所以目标mac其实是主机上veth-pod-a的mac地址。
2. 从host1去往host2的过程中，所以源MAC是host1的eth0网卡的mac，目标MAC是host2的eth0网卡的mac。
3. 从host2发往pod-b，源mac是host2上veth-pod-b网卡的mac，目标mac是pod-b的eth0网卡mac

这是跨节点容器通信方式中最简单高效的方式，没有封包拆包带来的额外消耗，但这种方式的使用场景有一些限制：

- 集群节点必须在相同网段，因为主机路由的下一跳必须是二层可达的地址，如果在不同网段也想要使用非overlay的方式，那就需要把上面的路由信息同步到节点所在机房的路由器了，这就是calico BGP的方式

- 云平台的虚拟机一般有源/目地址检查，流量从虚拟机出来时，如果源IP或源MAC与虚拟机不符，则丢包；我们使用主机路由时，源MAC是虚拟机的，但源IP是pod的，所以就被丢包了；实在是想要在云平台使用主机路由的话：

- - 关闭“源/目地址检查”（华为云），VPC路由表要加路由（阿里云、腾讯云）
  - ECS所属的安全组策略中要放开pod的网段

> 云平台的虚拟机为什么要做源/目地址检查呢？因为要防止IP spoofing

因为以上限制，host-gw通常在idc机房且节点数不多都在同一子网的情况下使用，或者与别的模式混合使用，比如flannel的DirectRouting开启时，相同网段的用host-gw，跨网段用vxlan；

有没有节点跨网段也能使用的模式呢？接下来介绍的ip tunnel（就是常说的ipip模式）就是了。

## ip tunnel（ipip）

ipip模式并不是像主机路由那样，修改数据包的mac地址，而是在原ip包的前面再加一层ip包，然后链路层是以外层ip包的目标地址封装以太网帧头，而原来的那层ip包更像是被当成了外层包的数据，完成这个封包过程的是linux 虚拟网络设备tunnel网卡，它的工作原理是用节点路由表中匹配原ip包的路由信息中的下一跳地址为外层IP包的目标地址，以本节点的IP地址为源地址，再加一层IP包头，所以使用ip tunnel的模式下，我们需要做两件事情：

- 在各个主机上建立一个one-to-many的ip tunnel，（所谓的one-to-many，就是创建ip tunnel设备时，不指定remote address，这样一个节点只需要一张tunnel网卡）
- 维护节点的路由信息，目标地址为集群的每一个的node-cidr，下一跳为node-cidr所在节点的IP，跟上面的主机路由很像，只不过出口网卡就不再是eth0了，而是新建的ip tunnel设备；

我们接着上面的环境继续操作：

- 首先删除上面使用主机路由时在两台主机上增加的路由条目

host1:

```bash
ip route del 192.168.11.0/24 via 10.57.4.21 dev eth0 onlink
```

host2:

```bash
ip route del 192.168.10.0/24 via 10.57.4.20 dev eth0 onlink
```

- 然后在两台主机上分别创建ip tunnel设备

host1:

```bash
ip tunnel add mustang.tun0 mode ipip local 10.57.4.20 ttl 64
ip link set mustang.tun0 mtu 1480 ##因为多一层IP头，占了20个字节，所以MTU也要相应地调整
ip link set mustang.tun0 up
ip route add 192.168.11.0/24 via 10.57.4.21 dev mustang.tun0 onlink
ip addr add 192.168.10.1/32 dev mustang.tun0 ## 这个地址是给主机请求跨节点的pod时使用的
```

host2:

```bash
ip tunnel add mustang.tun0 mode ipip local 10.57.4.21 ttl 64
ip link set mustang.tun0 mtu 1480
ip link set mustang.tun0 up
ip route add 192.168.10.0/24 via 10.57.4.20 dev mustang.tun0 onlink
ip addr add 192.168.11.1/32 dev mustang.tun0
```

这时候两个pod应该已经可以相互ping通了，还是假设pod-a请求pod-b的http服务，此时host1发往host2的数据包是长这样的：

![img](https://cdn.jsdelivr.net/gh/CoderSJX/nullpointer-images/images/202404201058454.webp)

图二：ipip

因为主机协议栈工作时是由下往上识别每一层包，所以ipip包对于主机协议栈而言，与正常主机间通信的包并没有什么不同，帧头中的源/目标mac是主机的，ip包头中源/目标ip也是节点的，这让节点所处的物理网络也感觉这是正常的节点流量，所以 这个模式相对于主机路由来说对环境的适应性更广，起码跨网段的节点也是可以通的，但是在云平台上使用这种模式还是要注意下，留意图二中外层IP包中的传输层协议号是不一样的（是IPPROTO_IPIP），正常的IP包头，这应该是TCP/UDP/ICMP，这样有可能也会被云平台的安全组策略拦截掉，在linux内核源码中可以看到：

```c
//include/uapi/linux/in.h
enum {
...
  IPPROTO_ICMP = 1,     /* Internet Control Message Protocol    */
#define IPPROTO_ICMP        IPPROTO_ICMP

  IPPROTO_IPIP = 4,     /* IPIP tunnels (older KA9Q tunnels use 94) */
#define IPPROTO_IPIP        IPPROTO_IPIP

  IPPROTO_TCP = 6,      /* Transmission Control Protocol    */
#define IPPROTO_TCP     IPPROTO_TCP

  IPPROTO_UDP = 17,     /* User Datagram Protocol       */
#define IPPROTO_UDP     IPPROTO_UDP
...
```

一般而言我们在云平台安全组设置规则时，传输层协议都只有三个可选项，就是：TCP、UDP、ICMP（没有IPIP），所以最好是在云平台上把安全组内的主机间的所有协议都放开，会不会真的被拦截掉要看具体云平台，华为云是会限制的；

> 笔者曾经试过在华为云上使用ipip模式，总会出现pod-a ping不通ping-b，卡着的时候，在pod-b上ping pod-a，然后两边就同时通了，这是典型的有状态防火墙的现象； 之后我们把集群节点都加入一个安全组，在安全组的规则配置中，把组内所有节点的所有端口所有协议都放开后，问题消失，说明默认对IPIP协议是没有放开的

在host1中执行：

```bash
ip netns exec pod-a ping -c 5 192.168.11.10
```

在host2的eth0用tcpdump打印一下流量，就能看到有两层ip头：

```bash
tcpdump -n -i eth0|grep 192.168.11.10

tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
18:03:35.048106 IP 10.57.4.20 > 10.57.4.21: IP 192.168.10.10 > 192.168.11.10: ICMP echo request, id 3205, seq 1, length 64 (ipip-proto-4)
18:03:35.049483 IP 10.57.4.21 > 10.57.4.20: IP 192.168.11.10 > 192.168.10.10: ICMP echo reply, id 3205, seq 1, length 64 (ipip-proto-4)
18:03:36.049147 IP 10.57.4.20 > 10.57.4.21: IP 192.168.10.10 > 192.168.11.10: ICMP echo request, id 3205, seq 2, length 64 (ipip-proto-4)
18:03:36.049245 IP 10.57.4.21 > 10.57.4.20: IP 192.168.11.10 > 192.168.10.10: ICMP echo reply, id 3205, seq 2, length 64 (ipip-proto-4)
```

calico的ipip模式就是这种，ip tunnel解决了主机路由不能在跨网段中使用的问题，在idc机房部署k8s集群的场景下，会拿host-gw和ipip两种模式混合使用，节点在相同网段则用host-gw，不同网段则用ipip，思路和flannel的directrouting差不多，只不过ipip比vxlan性能要好一些；

ip tunnel仍然有一些小小的限制，像上面说的云平台安全组对协议限制的问题，下面再介绍一种终极解决方案，只要节点网络是通的，容器就能通，完全没有限制，这就是vxlan模式；

## vxlan

主机路由是按普通路由器的工作原理，每一跳修改MAC地址；ipip模式是给需要转发的数据包前面加一层IP包；而vxlan模式则是把pod的数据帧（注意这里是帧，就是包含二层帧头）封装在主机的UDP包的payload中，数据包封装的工作由linux虚拟网络设备vxlan完成，vxlan设备可以用下面的命令创建：

```bash
ip link add vxlan0 type vxlan id 100 dstport 4789 local 10.57.4.20 dev eth0
##设备名为vxlan0
##vxlan id 为 100
##dstport指示使用哪个udp端口
##eth0指示封装好vxlan包后通过哪个主机网卡发送
```

vxlan设备在封包时是根据目标MAC地址来决定外层包的目标IP，所以需要主机提供目标MAC地址与所属节点IP的映射关系，这些映射关系存在主机的fdb表（forwarding database）中，fdb记录可以用下面的命令查看：

```bash
bridge fdb show|grep vxlan0

8a:e7:df:c0:84:07 dev vxlan0 dst 10.57.4.21 self permanent
```

上面的记录的意思是说去往MAC地址为`8a:e7:df:c0:84:07`的pod在节点IP为`10.57.4.21`的节点上，fdb的信息可以手工维护，也可以让vxlan设备自动学习；

- 手工添加一条fdb记录的命令如下：

```bash
bridge fdb append 8a:e7:df:c0:84:07 dev vxlan0 dst 10.57.4.21 self permanent
```

- 如果需要让vxlan设备去学习fdb记录，可以创建vxlan设备时设置多播地址，并开启learning选项：

```bash
ip link add vxlan0 type vxlan id 100 dstport 4789 group 239.1.1.1 dev eth0 learning
```

所有集群的节点都加入这个多播组，这样就能自动学习fdb记录了，当然这需要底层网络支持多播；

- 也可以通过增加全0的fdb记录来告诉vxlan设备遇到不知道下一跳的MAC应该向哪些节点广播：

```bash
bridge fdb append  00:00:00:00:00:00 dev vxlan0 dst 10.57.4.21 self permanent
```

我们接着上面的环境继续往下做，先把mustang.tun0删除，在两个节点上执行：

```bash
ip link del mustang.tun0
```

然后 host1：

```bash
ip link add vxlan0 type vxlan id 100 dstport 4789 local 10.57.4.20 dev eth0 learning  ## 这个eth0要根据你自己测试节点的网卡调整
ip addr add 192.168.10.1/32 dev vxlan0
ip link set vxlan0 up
ip route add 192.168.11.0/24 via 192.168.11.1 dev vxlan0 onlink
bridge fdb append  00:00:00:00:00:00 dev vxlan0 dst 10.57.4.21 self permanent
```

host2：

```bash
ip link add vxlan0 type vxlan id 100 dstport 4789 local 10.57.4.21 dev eth0 learning  ## 这个eth0要根据你自己测试节点的网卡调整
ip addr add 192.168.11.1/32 dev vxlan0
ip link set vxlan0 up
ip route add 192.168.10.0/24 via 192.168.10.1 dev vxlan0 onlink
bridge fdb append  00:00:00:00:00:00 dev vxlan0 dst 10.57.4.20 self permanent
```

这时候两台主机的pod应该可以相互ping通了

```bash
ip netns exec pod-b ping -c 5 192.168.10.10
PING 192.168.10.10 (192.168.10.10) 56(84) bytes of data.
64 bytes from 192.168.10.10: icmp_seq=1 ttl=62 time=0.375 ms
64 bytes from 192.168.10.10: icmp_seq=2 ttl=62 time=0.497 ms
64 bytes from 192.168.10.10: icmp_seq=3 ttl=62 time=0.502 ms
64 bytes from 192.168.10.10: icmp_seq=4 ttl=62 time=0.386 ms
64 bytes from 192.168.10.10: icmp_seq=5 ttl=62 time=0.390 ms
--- 192.168.10.10 ping statistics ---
5 packets transmitted, 5 received, 0% packet loss, time 4000ms
rtt min/avg/max/mdev = 0.375/0.430/0.502/0.056 ms
```

此时pod-a请求pod-b的http服务，数据包从host-1发往host-2时是长这样的：

![img](https://cdn.jsdelivr.net/gh/CoderSJX/nullpointer-images/images/202404201058124.webp)

图三：vxlan

可以看到，vxlan包是把整个pod-a发往pod-b最原始的帧都装进了一个udp数据包的payload中，整个流程简述如下：

- 1､pod-a数据包到达host-1，源ip为pod-a，目标ip为pod-b，源mac为pod-a，目标mac为host-1中的veth-pod-a
- 2､主机因为开启了转发，所以查找路由表中去往pod-b的下一跳，查到匹配的路由信息如下：

```bash
192.168.11.0/24 via 192.168.11.1 dev vxlan0 onlink  
## 这是我们在上面的host1执行的命令中的第四条命令添加的
```

- 3､于是主机把数据包给了vxlan0，并且下一跳为192.168.11.1，此时vxlan0需要得到192.168.11.1的mac地址，但主机的邻居表中不存在，于是vxlan0发起arp广播去询问，vxlan0的广播范围是由我们配置的，这个范围就是我们给他加的全0 fdb记录标识的dstIP，就是上面命令中的：

```bash
bridge fdb append  00:00:00:00:00:00 dev vxlan0 dst 10.57.4.21 self permanent
```

所以，这里找到的目标只有一个，就是10.57.4.21，然后vxlan就借助host1的eth0发起了这个广播，只不过eth0发起的不是广播，而是有明确目标IP的udp数据包，如果上面我们是配置了多个全0的fdb记录，这里eth0就会发起多播。

- 4､192.168.11.1这个地址是我们配置在host2上的vxlan0的网卡地址，于是host2会响应arp请求，host1的vxlan设备得到192.168.11.1的mac地址后，vxlan会从主机的fdb表中查找该mac的下一跳的主机号，发现找不到，于是又发起学习，问谁拥有这个mac，host-2再次应答，于是vxlan0就拥有了封包需要的全部信息，于是把包封装成图三的样子，扔给了host1的eth0网卡；
- 5､host2收到这个包后，因为是一个普通的udp包，于是一直上送到传输层，传输层对于这个端口会有个特殊处理，这个特殊处理会把udp包里payload的信息抠出来扔给协议栈，重新走一遍收包流程。（vxlan的原理后面有机会专门写一篇文章）

> vxlan学习fdb的方式难免会在主机网络间产生广播风暴，所以flannel的vxlan模式下，是关闭了vxlan设备的learning机制，然后用控制器维护fdb记录和邻居表记录的

可以看到这个过程中两次都需要用到全0的fdb记录，我们也可以在host1上查看vxlan0学习到的fdb记录和邻居表信息：

```bash
bridge fdb|grep vxlan0

00:00:00:00:00:00 dev vxlan0 dst 10.57.4.21 self permanent ## 这是我们手工添加的
6e:39:38:33:7c:24 dev vxlan0 dst 10.57.4.21 self   ## 这是vxlan0自动学习的，6e:39:38:33:7c:24 正是host2中vxlan0的地址
```

邻居表记录：

```bash
ip n

192.168.11.1 dev vxlan0 lladdr 6e:39:38:33:7c:24 STALE
```

在pod-b中ping pod-a的时候，在host1打开网卡监听，拦截的数据如下：

```bash
tcpdump -n -i eth0 src 10.57.4.21

tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
10:21:01.050849 IP 10.57.4.21.55255 > 10.57.4.20.otv: OTV, flags [I] (0x08), overlay 0, instance 1
IP 192.168.11.10 > 192.168.10.10: ICMP echo request, id 26972, seq 15, length 64
10:21:02.051894 IP 10.57.4.21.55255 > 10.57.4.20.otv: OTV, flags [I] (0x08), overlay 0, instance 1
IP 192.168.11.10 > 192.168.10.10: ICMP echo request, id 26972, seq 16, length 64
......
```

可以看到也是两层包头，外层包头显示这是otv（overlay transport virtualization）包，对于otv，用一句话解释：

***OTV is a "MAC in IP" technique to extend Layer 2 domains over any transport\***

从上面的过程可以看出来，vxlan模式依赖udp协议和默认的4789端口，所以在云平台的ECS上使用vxlan模式，还是需要在安全组上把udp 4789端口放开

> 什么终极解决方案，弄了半天也是要设置安全组的哈哈哈！！

## 一些误解

1. 是不是用了隧道模式，网络策略就不起效了？

不是的，不管是ipip还是vxlan模式下，主机协议栈把外层包头摘掉后，会把原始数据包重新扔回协议栈，重走一遍netfilter的几个点，所以针对podIP的防火墙策略依旧会生效的；

## 对比几种常用的cni

- flannel

- - vxlan模式兼容性强，但速度差一点
  - host-gw模式：只有二层直联的环境才能用，节点不能在多个子网，速度最快
  - 不支持network policy

- calico

- - bgp在idc机房较合适，云平台不支持
  - ipip模式，兼容性强，速度比vxlan好，最推荐
  - 支持network policy

- cilium

- - 性能好，也支持network policy，但对linux内核有要求（推荐是4.18以上）
  - 对于运维来说比较有难度，因为一切都是新的，没有iptables/ipvs，以前的排错经验用不上

## 解答上一篇问题

- 使用ipvs模式时，k8s集群的每个节点会有一张叫kube-ipvs0的网卡，网卡下挂着所有的clusterIP，有什么作用？

看回上一篇文章的图一，ipvs工作在netfilter扩展点中的LOCAL_IN点（也就是INPUT点），之前的内容中提过，流量在经过IPIsLocal时，会判断目标IP是否为本机地址，如果是则会走INPUT点，否则走FORWATD；为了让ipvs能操作流量，必须先让流量先到达INPUT点，于是就把所有clusterIP都挂在kube-ipvs0上，所有访问clusterIP的流量到达IPIsLocal点时，主机协议栈都会认为这是去往本机的流量，转到INPUT点去；

- 下面这条iptables规则到底有什么作用？

```bash
-A KUBE-FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

首先要了解，现在的防火墙技术都是基于连接状态的基础之上的，就是常说的***有状态的防火墙\***；

拿上面的pod-a和pod-b来举例，假设我们不允许pod-a访问pod-b，于是在host1上创建一条这样的iptables规则：

```bash
iptables -A FORWARD -t filter -s 192.168.10.10 -d 192.168.11.10 -j DROP
```

好了，这时候pod-a中去ping pod-b已经不通了，但是，pod-b中去ping pod-a也不通了，因为pod-a回pod-b的包也命中了上面那条策略；

当我们说：***不允许pod-a访问pod-b，只是说不允许pod-a主动访问pod-b，但是允许pod-a被动访问pod-b\***

这个听着有点绕，类似你跟你的二逼朋友说：平时没事别主动给老子打电话，但老子打你电话你要接！

好了，问题来了，怎么标识这是主动和流量还是被动的流量呢？这个问题linux内核协议栈已经帮我们解决好了，linux内核协议栈会悄悄维护连接的状态：

- 当pod-a向pod-b主动发送数据包时，到达pod-b时，连接状态为NEW；
- 当pod-b主动向pod-a发送数据包，pod-a回给pod-b的数据包到达pod-b时，连接状态为ESTABLISHED；

于是我们只要优先放过所有的连接状态为ESTABLISHED的包就可以了，问题中的命令的作用正是这个：

```bash
-A KUBE-FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

`-m conntrack`是说使用连接追踪模块标识的数据包状态，`--ctstate`是connection track state（连接追踪状态）的简称，状态值有：NEW/ESTABLISHED/INVALID/RELATED等，各种状态的解释自行google；

上面这条规则的优先级一般都是最高的，如果放在其它限制规则的后面就没有意义了，不单是容器平台的防火墙策略，大多数云平台网络中ACL、安全组的策略也是这种玩法；

Fannel-hostgw 和 Calico BGP 是两种不同的网络插件，在Kubernetes（K8s）集群中用于实现容器网络通信。它们的设计和工作原理不同，导致了对二层（数据链路层）和三层（网络层）网络支持上的差异。

**Fannel-hostgw (Flannel Host-Gateway Mode)**:
Fannel 是一个轻量级的网络解决方案，用于在Kubernetes集群中的不同节点间创建扁平化的、可路由的网络空间。Fannel-hostgw 模式是一种特定的实现方式，其中每个节点上的主机网关（Host Gateway）负责将容器网络流量桥接到本地物理网络。在这种模式下：

1. **仅支持二层网络**：Fannel-hostgw 不涉及三层路由，它依赖于每个节点上的Linux内核实现二层网络通信。容器IP地址直接与宿主机的MAC地址关联，通过ARP协议（Address Resolution Protocol）在同一个二层广播域内建立映射关系。

2. **缺乏三层支持**：由于Fannel-hostgw 不具备路由功能，路由器（如边缘路由器或数据中心路由器）无法直接了解到每个Pod IP与宿主机MAC地址之间的映射。这意味着路由器的路由表中不会存储这类信息，也无法基于Pod IP进行三层路由决策。

3. **通信局限性**：由于上述原因，Fannel-hostgw 部署的Kubernetes集群中，跨节点的Pod间通信必须依赖于二层网络的连通性，即所有节点必须位于同一个二层广播域内，或者通过二层桥接技术（如VLAN、TRILL等）虚拟扩展为一个逻辑二层域。对于跨越多个三层网络区域的大型集群，这种设计可能会遇到扩展性和性能瓶颈。

**Calico BGP**:
Calico 是另一种流行的Kubernetes网络解决方案，它采用边界网关协议（Border Gateway Protocol, BGP）作为核心的网络通信机制。

1. **支持二、三层网络**：Calico 集成了BGP路由协议，允许每个宿主机作为一个BGP客户端与网络中的BGP路由器（如边缘路由器或支持BGP的三层交换机）建立会话。这样，每个宿主机不仅能够参与二层通信，还能够参与三层路由。

2. **Pod IP到宿主机MAC映射**：当Calico启用BGP模式时，每个宿主机上的Calico agent会将其管理的Pod IP地址作为BGP路由信息发布出去。这些路由信息包含了Pod IP范围及其对应的宿主机接口（及相应的MAC地址）。这样，支持BGP的路由器就能够在其路由表中存储这些映射关系。

3. **三层路由能力**：由于路由器知道了每个Pod IP与宿主机MAC地址的对应关系，它可以基于这些信息做出正确的三层路由决策，将发往Pod IP的数据包正确地转发到承载该Pod的宿主机。这意味着Calico BGP模式下的Kubernetes集群可以跨越多个三层网络区域，无需依赖二层连通性，极大地增强了网络的可扩展性和灵活性。

总结起来，Fannel-hostgw 因为仅依赖二层网络通信，不支持三层路由，所以在路由器中不存在Pod IP到宿主机MAC地址的映射信息，这限制了其在复杂网络环境中的应用。而Calico BGP通过引入BGP路由协议，使得支持BGP的路由器能够获知并存储这些映射关系，从而支持跨三层网络的Pod间通信，适应大规模、多区域的Kubernetes集群部署。
