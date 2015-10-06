/**
 * Mocha tests for the etcd-mirror module.
 */
var assert = require("assert"),
    fs = require("fs"),
    util = require("util"),
    debug = require("debug")("etcd-mirror"),
    tmp = require("tmp"),
    Q = require("q"),
    etcd_mirror = require("../../etcd-mirror"),
    EtcdMirror = etcd_mirror.EtcdMirror,
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
    describe.only("DirectoryState", function () {
        var DirectoryState = etcd_mirror.forTestsOnly.DirectoryState;
        it.only("writes files", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            ds.set("/zoinx", "AAA").then(function () {
                var contents = fs.readFileSync(tmpobj.name + "/zoinx");
                assert.equal(contents, "AAA");
            }).thenTestDone(done);
        });
        it("creates subdirectories if needed", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name + "/quux");
            ds.set("/zoinx/foo", "AAA").then(function () {
                var contents = fs.readFileSync(tmpobj.name + "/quux/zoinx/foo");
                assert.equal(contents, "AAA");
            }).thenTestDone(done);
        });
        it("deletes files", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            fs.mkdirSync(tmpobj.name + "/foo");
            fs.writeFileSync(tmpobj.name + "/foo/bar", "ZZZ");
            var ds = new DirectoryState(tmpobj.name);
            ds.delete("/foo/bar".then(function () {
                assert(! fs.existsSync("/foo/bar"));
            }));
        });
        it("doesn't mind deleting nonexistent files", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            ds.delete("/foo/bar".then(function () {
                assert(! fs.existsSync("/foo/bar"));
            }));
        });
        it("removes subdirectories if needed");
        it("throws (rejects promises) on write errors", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            fs.mkdirSync(tmpobj.name + "/foo/bar");
            Promise.resolve().then(function () {
                return ds.set("/foo/bar", "A");
            }).then(function () {
                done(new Error("Should have thrown"));
            }, function (error) {
                done();
            });
        });
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