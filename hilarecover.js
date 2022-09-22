/*
usage: node hilagit.js docID commitID
*/
let docID = process.argv[2]
let commitID = process.argv[3];
let itemID = process.argv[4];

let fileManager = require("./hilagit").FileManager;
var private = require('./private');
let theFileManager = new fileManager(docID, private.baseGitLocation + "/" + docID);
if (commitID == "ls") {
    console.log(Object.keys(theFileManager.commits).join("\n"));
} else {
    let theCommit = theFileManager.collateForClient(commitID);
    if (itemID) {
        console.log(JSON.stringify(theCommit[itemID]))
    } else {
        console.log(JSON.stringify(theCommit));
    }
}