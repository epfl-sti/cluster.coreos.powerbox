/**
 * Mocha tests for the etcd-mirror module.
 */
var util = require("util"),
    EventEmitter = require('events').EventEmitter,
    LocalEtcd = require('../local-etcd').LocalEtcd;

/**
 * Fake node-etcd instance
 * @constructor
 */
var FakeEtcd = function () {
};
util.inherits(FakeEtcd, EventEmitter);

Promise.prototype.thenTestDone = function (done) {
    this.then(done, function (err) { done(null, err); });
};

function startEtcd() {

}

describe("etcd-mirror module", function () {
    var localEtcd = new LocalEtcd();
    before(function (done) {
        done();  // TODO
        // Caution here: performance hack.
        // This is a "before", not a "beforeEach", therefore tests must
        // take care not to depend on each other's state.
    });
    describe("DirectoryState read tests", function () {
        it("reads a directory state");
        it("treats a nonexistent directory as empty");
        it("throws (rejects promises) on other read errors");
    });
    describe("DirectoryState write tests", function () {
        it("writes files");
        it("creates subdirectories if needed");
        it("deletes files");
        it("removes subdirectories if needed");
        it("throws (rejects promises) on write errors");
    });

    describe("EtcdMirror", function () {
        it("mirrors from a steady depot into an empty directory", function (done) {

        });
        it("cares only about the subdirectory it is told to mirror");
    });
});