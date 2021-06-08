/*
Nanogram js

Functions:
new nanogram({
    udpPort
    transmitPort
    callWord
}): returns:{
    on(): for adding listeners to events. only one supported right now is newPeer.
    connectTo(ID): pass a peer ID and it'll connect to the peer; messages still routed through addEventListener
    getPeers(): returns list of peers as array of string
    id: self's ID. if not specified, generates own uniqueish ID using some property unique to the computer (RNG(100) * 1e14 + date.time())
}



usage

let nng = new nanogram();

let prpeareClient=(client)=>{
    client.connection.addEventListener("data",()=>{
        switch (client.state){
            //do stuff
        }
    })
    if (client.state=="begin"){
        client.connection.write("hello world!"); // introduce yourself!
        client.state="wait";
        setTimeout(()=>{
            client.write("I'm doing something regular");
            client.state="waitingregular"
        }, 1000)
    }
}

nng.on("newPeer",(id)=>{
    if (we want to connect){
        client=await nng.connectTo(id);
        prepareClient(client);
    }
})

*/


const dgram = require('dgram');
const net = require('net');
const os = require('os');
module.exports = function nanogram(id, _options) {
    //resolve id and options
    if (!id) {
        //try and get the mac address
        id = Math.floor(Math.random() * 100) * 1e14 + Date.now();
    }
    let options = {
        udpPort: 11233,
        transmitPort: -1,
        callWord: "nanogram",
        waitPeriod: 1000,
        transmitPeriod: -1
    }
    Object.assign(options, _options);
    if (options.transmitPort < 0) options.transmitPort = options.udpPort + Date.now() % (65534 - options.udpPort);
    if (options.transmitPeriod < 0) options.transmitPeriod = options.waitPeriod * 2 / 3;

    //add an event api
    this.events = {};
    this.fire = (e, args) => {
        let _e = e.split(",");
        _e.push("*"); // a wildcard event listener
        _e.forEach((i) => {
            if (!this.events[i]) return;
            if (this.events[i].events) {
                this.events[i].events.forEach((f) => {
                    try {
                        f(args)
                    } catch (er) {
                        console.log(er);
                    }
                });
            }
        })
    };
    this.on = (e, f) => {
        let _e = e.split(',');
        _e.forEach((i) => {
            if (!this.events[i]) this.events[i] = {};
            if (!this.events[i].events) this.events[i].events = [];
            this.events[i].events.push(f);
        })
    };

    //create a udp port
    const server = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    server.bind(options.udpPort, undefined, () => {
        server.setBroadcast(true);
    })

    server.on('error', (err) => {
        console.log(`server error:\n${err.stack}`);
        server.close();
    });


    let knownPeers = {};
    server.on('message', (msg, rinfo) => {
        //if in correct format, add to the list
        //console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
        msg = msg.toString();
        try {
            let message = JSON.parse(msg);
            if (message.callWord == options.callWord) {
                //add it to the list of known clients
                let newPeer = false;
                if (message.id == id) return;
                if (!knownPeers[message.id]) {
                    newPeer = true;
                    knownPeers[message.id] = {};
                }
                if (knownPeers[message.id].missingTimeout) clearInterval(knownPeers[message.id].missingTimeout);
                Object.assign(knownPeers[message.id], {
                    addr: rinfo.address,
                    port: message.port,
                    id: message.id,
                    lastSeen: Date.now(),
                    missingChances: 3,
                    missingTimeout: setInterval(() => {
                        knownPeers[message.id].missingChances--;
                        if (knownPeers[message.id].missingChances == 0) {
                            clearInterval(knownPeers[message.id].missingTimeout);
                            this.fire("lostPeer", message.id);
                            delete knownPeers[message.id];
                        }
                    }, options.waitPeriod + 500)
                })
                for (let i of message.conreqs) {
                    if (i == id) {
                        if (knownPeers[message.id].conreq) {
                            if (knownPeers[message.id].conreq != true) {
                                let socket = net.createConnection({ host: knownPeers[message.id].addr, port: knownPeers[message.id].port }, () => {
                                    socket.write(`nanogram_${id}`, () => {
                                        setTimeout(() => {
                                            knownPeers[message.id].conreq({
                                                connection: socket,
                                                id: message.id,
                                                state: "begin"
                                            }); // otherwise first message is merged w nanogram id.
                                        }, 100);
                                    });
                                });
                            }
                        } else {
                            knownPeers[message.id].conreq = true;
                        }
                    }
                }
                if (newPeer) {
                    this.fire("newPeer", message.id);
                }
            }
        } catch (e) {
            console.log(e);
            return;
        }
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`server listening ${address.address}:${address.port}; self id is ${id}`);
    });

    let conreqs = {};

    //figure out which address(es) to broadcast on
    let fetchBroadcastAddresses = () => {
        let baddrs = [];
        let infs = os.networkInterfaces();
        for (let inf in infs) {
            for (let addrblock of infs[inf]) {
                if (addrblock.family == "IPv4" && addrblock.mac != "00:00:00:00:00:00") {
                    let nmn = addrblock.netmask.split(".").map(i => Number(i));
                    let na = addrblock.address.split(".").map(i => Number(i));
                    baddrs.push(na.map((v, i) => v | (255 ^ nmn[i])).join("."));
                }
            }
        }
        return baddrs;
    }

    setInterval(() => {
        let message = JSON.stringify({
            port: options.transmitPort,
            id: id,
            callWord: options.callWord,
            conreqs: Object.keys(conreqs)
        })
        let baddrs = fetchBroadcastAddresses();
        for (let i of baddrs) {
            server.send(message, 0, message.length, options.udpPort, i);
        }
    }, options.transmitPeriod)

    //create a tcp listener
    let tcpserv = net.createServer((s) => {
        s.once("data", (data) => {
            data = data.toString();
            console.log(data);
            let nanotag = /nanogram_(\d+)/.exec(data);
            if (nanotag) {
                if (conreqs[nanotag[1]]) {
                    conreqs[nanotag[1]]({
                        connection: s,
                        id: nanotag[1],
                        state: "wait"
                    });
                    delete conreqs[nanotag[1]];
                } else {
                    s.end();
                }
            } else {
                s.end();
            }
        });
        s.on("error", (e) => {
            // don't die
            console.log(e);
        })
    })

    tcpserv.listen(options.transmitPort, "0.0.0.0");
    tcpserv.on('clientError', (e, socket) => {
        socket.end();
    })
    this.connectTo = async(targetID) => {
        return new Promise((res) => {
            if (targetID < id) {
                // we need to create con
                if (!knownPeers[targetID]) {
                    throw "Peer cannot be found.";
                }
                if (knownPeers[targetID].conreq == true) {
                    try {
                        let socket = net.createConnection({ host: knownPeers[targetID].addr, port: knownPeers[targetID].port }, () => {
                            socket.write(`nanogram_${id}`, () => {
                                setTimeout(() => {
                                    res({
                                        connection: socket,
                                        id: targetID,
                                        state: "begin"
                                    }); // otherwise first message is merged w nanogram id.
                                }, 100);
                            });
                        });
                        socket.on('error', (e) => {
                            console.log(e);
                            // retry
                            setTimeout(() => {
                                this.connectTo(targetID);
                            }, 3000);
                        })
                    } catch (e) {
                        console.log("Connection attempt failed: " + e.toString());
                    }
                } else { // will overwrite previous conreqs. TODO: make array? 
                    knownPeers[targetID].conreq = res;
                }
            } else {
                // tell self to broadcast conreq intent
                conreqs[targetID] = res;
            }
        })
    }

}

/*

1.connect()
1 broadcasts conreq to 2, since lower id
2 recieves conreq, sets flag
2.connect(), sees flag
2 conns to 1

1.connect()
1 broadcasts conreq to 2, since lower id
2.connect(), sees no flag
2 recieves conreq, sees flag
2 conns to 1

2.connect(), sees no flag, sets flag
1.connect()
1 broadcasts conreq to 2, since lower id
2 recieves conreq, sees flag
2 conns to 1

*/