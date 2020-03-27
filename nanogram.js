//client start
/*THE HASH
Must tell if versions are different

EACH datapoint
must have last modified + data
must be ordered

IN CASE OF CONFLICT
take most recent one, always
*/

const dgram = require('dgram');
const net = require('net');

module.exports = function nanogram(id, _options) {
    const server = dgram.createSocket('udp4');
    let options = {
        udpPort: 11233,
        transmitPort: -1,
    }
    Object.assign(options, _options);
    if (options.transmitPort < 0) options.transmitPort = options.udpPort + Date.now() % (65534 - options.udpPort);
    //create a tcp port

    let message;
    let mydata;
    let previousBroadcastTimer = undefined;
    let lastUpdateTime;
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

    function elstrToObj(elstr) {
        let p = elstr.split("|");
        console.log(p);
        let o = {};
        for (let i = 0; i < p.length; i++) {
            if (p[i]) {
                let ab = p[i].split("!");
                o[ab[0]] = ab[1];
                console.log(ab);
            }
        }
        return o;
    }

    function encodeString(str) {
        let charbox = [];
        let place = 0;

        for (let i = 0; i < str.length; i++) {
            if (charbox.length < place + 1) charbox.push(0);
            charbox[place] += str.charCodeAt(i);
            charbox[place] %= 49;
            place++;
            place %= 64;
        }
        charbox = charbox.map((i) => String.fromCharCode(i + 48));
        return charbox.join("");
    }

    function encodeSub(data) {
        let output = "";
        for (let i in data) {
            output += i + "!" + encodeList(data[i]) + "|";
        }
        return output;
    }

    function encodeList(data) {
        //hash the list.
        let asString = JSON.stringify(data);
        return encodeString(asString);
    }


    let tcpserv = net.createServer((s) => {
        console.log(`ATTEMPT PUSH TO ${s.address().address}`);
        //stop calling out
        clearInterval(previousBroadcastTimer);
        // someone wants to pull from me!
        //First check that our IDs are the same and our versions are the same.
        //Recieve their liststring; check our liststring
        let stage = 0;
        let keys;
        let inindex = 0;
        s.on("data", (data) => {
            console.log(`push recieved ${data}`);
            let strdata = data.toString();
            switch (stage) {
                case 0:
                    //send my liststring
                    s.write(encodeSub(mydata));
                    console.log(encodeSub(mydata));
                    stage++;
                    inindex=0;
                    break;
                case 1:
                    //get the items they want
                    if (strdata != "!!") {
                        keys = strdata.split("|");
                    }
                    console.log(keys);
                    if (inindex < keys.length) {
                        if (keys[inindex]) {
                            s.write(keys[inindex] + ":" + JSON.stringify(mydata[keys[inindex]]));
                        }
                        inindex++;
                    } else {
                        s.end();
                    }
                    break;
            }
        })
    })

    tcpserv.listen(options.transmitPort);
    //get their liststring

    let pull = (port, addr) => {
        let socket = net.createConnection({ host: addr, port: port }, () => {
            clearInterval(previousBroadcastTimer);
            console.log(`ATTEMPT PULL FROM ${addr}`);

            let stage = 0;
            socket.on("data", (data) => {
                console.log(`pull recieved ${data}`);
                let strdata = data.toString();
                switch (stage) {
                    case 0:
                        let els = elstrToObj(strdata);
                        let toPull = [];
                        let myels = elstrToObj(encodeSub(mydata));
                        if (mydata) {
                            for (let i in els) {
                                if (els[i] != myels[i]) {
                                    //request to pull
                                    toPull.push(i);
                                }
                            }
                        }
                        if (!toPull.length) {
                            socket.end();
                        } else {
                            console.log(`sent${toPull.join("|")}`);
                            socket.write(toPull.join("|"));
                        }
                        stage++;
                        break;
                    case 1:
                        //lots of messages coming throught
                        let p = strdata.indexOf(":");
                        mydata[strdata.slice(0, p)] = JSON.parse(strdata.slice(p + 1));
                        socket.write("!!");
                        break;
                }
            });
            socket.on("close", () => {
                this.fire("change", mydata);
            });
            socket.write("ready");
        });
    }

    let nanogramReady = false;
    server.bind(options.udpPort, undefined, () => {
        server.setBroadcast(true);
        nanogramReady = true;
    })

    server.on('error', (err) => {
        console.log(`server error:\n${err.stack}`);
        server.close();
    });

    server.on('message', (msg, rinfo) => {
        console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
        msg = msg.toString();
        if (message) {
            let msplit = msg.split("|");
            let messsplit = message.split("|");
            if (msplit[0] != messsplit[0] && msplit[1] == messsplit[1] && Number(messsplit[3]) < Number(msplit[3])) {
                //fire me at their tcp to pull
                pull(Number(msplit[2]), rinfo.address);
            }
        }
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`server listening ${address.address}:${address.port}`);
    });

    this.on('newData,change', function ready(data) {
        mydata = data;
        lastUpdateTime = Date.now();
        if (nanogramReady) {
            //start broadcasting
            if (previousBroadcastTimer != undefined) {
                clearInterval(previousBroadcastTimer);
            }
            message = `${encodeList(data)}|${id}|${options.transmitPort}|${lastUpdateTime}`;
            previousBroadcastTimer = setInterval(() => {
                server.send(message, 0, message.length, options.udpPort, "255.255.255.255");
                console.log(`sent ${message}`);
            }, 1000);
        } else {
            setTimeout(() => { ready(data), 1000 });
        }
    })

    //now for TCP connections
    //create new tcp listener
    //when tcp listener receives data, merge it.



}




///////////////usage
/*
nanogram.on('update',(newdata)=>{
    //the new data, for you to do as you will.
})

nanogram.fire('newData',data);
//push data to nanogram.

let data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
//data MUST be a javascript object. if you just need an array, make it like {0: item0, 1: item1} etc.
// for consistency's sake.

*/






// Prints: server listening 0.0.0.0:41234



//occasionally, broadcast on UDP to others
//document name, revision hash, port i can listen on

// listen for udp broadcasts
// if hear one, compare to current hash. 

//if different, say hi by trying to establish TCP connection

//listen for connections. When connection made, temporarily pause broadcast

//send over all hashes

//compare hashes, tell which ones are different

//For different ones, which is earlier?