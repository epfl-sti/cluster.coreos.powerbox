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

// TODO: make mappings dynamic
var mirrored = ["stiitops", "nborboen"];
mirrored.forEach(function (tenantName) {
    var mirror = new EtcdMirror(
        client, "/" + tenantName,
        "/run/power/" + tenantName);
    mirror.start();
});
