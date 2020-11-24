let nanogram = require("./nanogram");
let nng = new nanogram();

let prepareClient = (client) => {
    client.connection.on("data", (data) => {
        data = data.toString();
        switch (client.state) {
            //do stuff
            case "wait":
                if (data == "hello world!") {
                    console.log("i got hello world!");
                }
                break;
        }
        console.log(data);
        console.log(client.state);
        console.log(client.id);
    })
    if (client.state == "begin") {
        client.connection.write("hello world!"); // introduce yourself!
        client.state = "wait";
    }
}

nng.on("newPeer", async(id) => {
    console.log("i have a friend" + id);
    client = await nng.connectTo(id);
    prepareClient(client);
})