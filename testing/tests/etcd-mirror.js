/**
 * Mocha tests for the etcd-mirror module.
 */
var assert = require("assert"),
    util = require("util"),
    debug = require("debug")("etcd-mirror"),
    EtcdMirror = require("../../etcd-mirror").EtcdMirror,
    EventEmitter = require('events').EventEmitter,
    LocalEtcd = require('../local-etcd').LocalEtcd;

require("../testlib.js");

/**
 * Fake node-etcd instance
 * @constructor
 */
var FakeEtcd = function () {
};
util.inherits(FakeEtcd, EventEmitter);

/**
 *
 * @constructor
 */
function FakeDirectoryState() {
    contents = {};
    var promiseOnNextTick = function() {
        return new Promise(function (resolve, reject) {
            process.nextTick(resolve);
        });
    };
    this.set = function (path, value) {
        contents[path] = value;
        debug("after set(), contents of fake is ", contents);
        return promiseOnNextTick();
    };
    this.delete = function (path) {
        delete contents[path];
        debug("after delete(), contents of fake is ", contents);
        return promiseOnNextTick();
    };
    this.dump = function() {return contents};
}

describe("etcd-mirror module", function () {
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
        var localEtcd = new LocalEtcd();
        this.timeout(60*1000);
        before(function (done) {
            return localEtcd.start().thenTestDone(done);
            // Caution here: performance hack.
            // This is a "before", not a "beforeEach", therefore tests must
            // take care not to depend on each other's state.
        });
        it("mirrors from a steady depot into an empty directory", function (done) {
            localEtcd.writeTestKeys([
                ["/foo/txt", "1234"],
                ["/foo/bar/baz", "abc"]
            ]).then(function () {
                    var fakeState = new FakeDirectoryState();
                    var mirror = new EtcdMirror(localEtcd.getClient(),
                        undefined, fakeState);
                    return mirror.sync().then(function () {
                        assert.deepEqual(fakeState.dump(), {
                            "/foo/txt": "1234",
                            "/foo/bar/baz": "abc"
                        });
                        return Promise.resolve();
                    });
                }).thenTestDone(done);
        });
        it("cares only about the subdirectory it is told to mirror");
        after(function (done) {
            LocalEtcd.killAll().thenTestDone(done);
        });
    });

});