'use strict';

var EtcdClient = require("node-etcd"),
    EtcdMirror = require("./etcd-mirror").EtcdMirror;

process.on("unhandledRejection", function (error, promise) {
    var type = (promise instanceof Promise) ? "native" : "Q";
    console.log("Unhandled rejection of a " + type + " promise");
    throw error;
});

var client = new EtcdClient(process.env.ETCD_HOST || "127.0.0.1",
    process.env.ETCD_PORT || 2379);

// TODO: make mapping dynamic; run multiple ones
var mirror = new EtcdMirror(client, "/stiitops", "/run/power/stiitops");
mirror.start();
