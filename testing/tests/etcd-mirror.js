/**
 * Mocha tests for the etcd-mirror module.
 */
var assert = require("assert"),
    fs = require("fs"),
    util = require("util"),
    debug = require("debug")("etcd-mirror-test"),
    tmp = require("tmp"),
    Q = require("q"),
    etcd_mirror = require("../../etcd-mirror"),
    EtcdMirror = etcd_mirror.EtcdMirror,
    EventEmitter = require('events').EventEmitter,
    LocalEtcd = require('../local-etcd').LocalEtcd,
    testlib = require("../testlib.js");


/**
 * Fake for the DirectoryState object in etcd-mirror module
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
    describe("DirectoryState", function () {
        var DirectoryState = etcd_mirror.forTestsOnly.DirectoryState;
        it("writes files", function (done) {
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
            ds.delete("/foo/bar").then(function () {
                assert(! fs.existsSync("/foo/bar"));
            }).thenTestDone(done);
        });
        it("doesn't mind deleting nonexistent files", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            ds.delete("/foo/bar").then(function () {
                assert(! fs.existsSync("/foo/bar"));
            }).thenTestDone(done);
        });
        it("treats relative paths and absolute paths the same", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            ds.set("/zoinx", "AAA").then(function () {
                return ds.set("zoinx2", "BBB")
            }).then(function() {
                assert.equal(fs.readFileSync(tmpobj.name + "/zoinx"), "AAA");
                assert.equal(fs.readFileSync(tmpobj.name + "/zoinx2"), "BBB");
            }).thenTestDone(done);
        });
        it("removes subdirectories if needed");
        it("throws (rejects promises) on write errors", function (done) {
            var tmpobj = tmp.dirSync({ mode: 0750, prefix: 'DirectoryState_test_' });
            var ds = new DirectoryState(tmpobj.name);
            fs.mkdirSync(tmpobj.name + "/foo");
            fs.mkdirSync(tmpobj.name + "/foo/bar");
            ds.set("/foo/bar", "A").then(function () {
                done(new Error("Should have thrown"));
            }).catch(function (error) {
                assert.equal(error.code, "EISDIR");
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
                    "/", fakeState);
                mirror.start();

                mirror.on("sync", function () {
                    assert.deepEqual(fakeState.dump(), {
                        "/foo/txt": "1234",
                        "/foo/bar/baz": "abc"
                    });
                    done();
                });
                mirror.on("error", done);
            });
        });
        it("cares only about the subdirectory it is told to mirror", function (done) {
            localEtcd.writeTestKeys([
                ["/bar/txt", "1234"],
                ["/bar/bar/baz/quux", "abc"]
            ]).then(function () {
                var fakeState = new FakeDirectoryState();
                var mirror = new EtcdMirror(localEtcd.getClient(),
                    "/bar/bar", fakeState);
                mirror.start();
                mirror.on("sync", function () {
                    assert.deepEqual(fakeState.dump(), {
                        "/baz/quux": "abc"
                    });
                    done();
                });
                mirror.on("error", done);
            });
        });

        it("syncs from a nonexistent directory", function (done) {
            var fakeState = new FakeDirectoryState();
            var mirror = new EtcdMirror(localEtcd.getClient(),
                "/no/such/directory", fakeState);
            mirror.start();
            mirror.on("sync", function () {
                assert.deepEqual(fakeState.dump(), {});
                done();
            });
            mirror.on("error", done);
        });

        it("mirrors continuous changes", function (done) {
            var fakeState = new FakeDirectoryState();
            var client = localEtcd.getClient();
            var mirror = new EtcdMirror(client, "/not/seen/yet", fakeState);
            mirror.start();
            testlib.whenEvent(mirror, "sync").then(function () {
                debug("sync event received");
                assert.deepEqual(fakeState.dump(), {});
                return Q.all([
                    // We don't really have to wait for the write to succeed,
                    // but in case it fails we want to fail as well.
                    Q.ninvoke(client, "set", "/not/seen/yet/key", "val"),
                    testlib.whenEvent(mirror, "change")
                ]);
            }).then(function() {
                debug("first changed event received");
                assert.deepEqual(fakeState.dump(), {"/key": "val"});
                return Q.ninvoke(client, "set", "/unrelated/key", "val");
            }).then(function() {
                debug("/unrelated/key done writing");
                return Q.all([
                    // Same as above: included to catch errors
                    Q.ninvoke(client, "set", "/not/seen/yet/key", "val2"),
                    // We expect a single "changed" event, since /unrelated/key
                    // is outside of the watched directory.
                    testlib.whenEvent(mirror, "change")
                ]);
            }).then(function() {
                debug("second changed event received");
                assert.deepEqual(fakeState.dump(), {"/key": "val2"});
            }).thenTestDone(done);
        });

        after(function (done) {
            LocalEtcd.killAll().thenTestDone(done);
        });
    });

});