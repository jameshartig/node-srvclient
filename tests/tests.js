var dns = require('native-dns'),
    SRVClient = require('../srv.js'),
    testHostname = '_srv-client-test._tcp.mysuperfancyapi.com',
    dnsServers = ['8.8.8.8', '8.8.4.4'];

exports.setServers = function(test) {
    var servers;
    SRVClient.setServers(dnsServers);
    servers = dns.getServers();
    test.equal(servers[0], dnsServers[0]);
    test.equal(servers[1], dnsServers[1]);
    test.done();
};

exports.getTarget = function(test) {
    test.expect(1);
    SRVClient.getTarget(testHostname, function(err, target) {
        test.equal(target.port, 8079);
        test.done();
    });
};

exports.getTargets = function(test) {
    test.expect(4);
    SRVClient.getTargets(testHostname, function(err, targets) {
        test.equal(targets.length, 3);
        test.equal(targets[0].port, 8079);
        test.equal(targets[1].port, 8080);
        test.equal(targets[2].port, 8081);
        test.done();
    });
};

//via: http://stackoverflow.com/a/12646864/45530
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}
exports.sort = function(test) {
    var iterations = 10;
    test.expect(iterations * 3);
    function correctOrder(targets) {
        test.equal(targets[0].port, 8079);
        test.equal(targets[1].port, 8080);
        test.equal(targets[2].port, 8081);
    }
    SRVClient.getTargets(testHostname, function(err, targets) {
        for (var i = 0; i < iterations; i++) {
            shuffleArray(targets);
            SRVClient.sortTargets(targets);
            correctOrder(targets);
        }
        test.done();
    });
};

exports.cache = function(test) {
    test.expect(1);
    SRVClient.getTarget(testHostname, 1000, function(err, target) {
        var cachedTarget = target;
        SRVClient.getTarget(testHostname, 1000, function(err, target) {
            test.strictEqual(target, cachedTarget);
            test.done();
        });
    });
};

exports.getRandomTargets = function(test) {
    SRVClient.getRandomTargets(testHostname, 1000, function(err, targets) {
        //this should always be last since it has a higher priority
        test.equal(targets[2].port, 8081);
        var num80 = 0;
        for (var i = 0; i < 100; i++) {
            SRVClient.getRandomTargets(testHostname, 1000, function(err, targets) {
                if (targets[0].port === 8080) {
                    num80++;
                }
            });
        }

        test.done();
    });
};

exports.resolveCaches = function(test) {
    SRVClient.getRandomTarget(testHostname, 1000, function(err, target) {
        target.resolve(function(err, address) {
            var cached = false;
            //if it is cached, it'll call the callback immediately
            target.resolve(function(err, address) {
                cached = true;
            });
            test.ok(cached);
            test.done();
        });
    });
};

exports.resolve6Caches = function(test) {
    SRVClient.getRandomTarget(testHostname, 1000, function(err, target) {
        target.resolve6(function(err, address) {
            var cached = false;
            //if it is cached, it'll call the callback immediately
            target.resolve6(function(err, address) {
                cached = true;
            });
            test.ok(cached);
            test.done();
        });
    });
};

exports.resolve46NotCache = function(test) {
    SRVClient.getRandomTarget(testHostname, 1000, function(err, target) {
        target.resolve6(function(err, address) {
            var cached = false;
            //if it is cached, it'll call the callback immediately but it shouldn't be cached
            target.resolve4(function(err, address) {
                cached = true;
            });
            test.notEqual(cached, true);
            test.done();
        });
    });
};

exports.fallback = function(test) {
    test.expect(1);
    SRVClient.setServers(['10.254.254.6'].concat(dnsServers));
    SRVClient.getTarget(testHostname, function(err, target) {
        test.equal(target.port, 8079);
        test.done();
    });
    SRVClient.setServers(dnsServers);
};

exports.timeout = function(test) {
    test.expect(1);
    SRVClient.setServers(['10.254.254.6']);
    SRVClient.getTarget(testHostname, function(err, target) {
        test.equal(target, null);
        test.done();
    });
    SRVClient.setServers(dnsServers);
};

exports.nxdomain = function(test) {
    test.expect(1);
    SRVClient.getTarget('hey.hey', function(err, target) {
        test.notEqual(err, null);
        test.done();
    });
};
