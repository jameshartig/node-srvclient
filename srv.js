var dns = require('native-dns'),
    net = require('net'),
    Log = require('modulelog')('srvclient'),
    cachedRecords = {},
    nextGarbageCollection = 0,
    currentCollectionTimeout = null,
    srvType = dns.consts.nameToQtype('SRV'),
    aType = dns.consts.nameToQtype('A'),
    aaaaType = dns.consts.nameToQtype('AAAA');
delete cachedRecords.a; //don't let V8 try to optimize

dns.setServers = function(list) {
    dns.platform.name_servers = list.map(function(item) {
        return { address: item };
    });
};
dns.getServers = function() {
    return dns.platform.name_servers.map(function(item) {
        return item.address;
    });
};

//todo: figure out how often to reload the servers

function scheduleGarbageCollection(time) {
    if (nextGarbageCollection === 0 || time < nextGarbageCollection) {
        if (currentCollectionTimeout !== null) {
            clearTimeout(currentCollectionTimeout);
        }
        nextGarbageCollection = time;
        currentCollectionTimeout = setTimeout(collectGarbage, time - Date.now());
        //don't let garbage collection prevent node from killing the app
        currentCollectionTimeout.unref();
    }
}

function collectGarbage() {
    //we can't reliably create a timeout in < 10 ms so just clean those now
    var now = Date.now() + 10,
        nextCollection = Infinity,
        name;
    for (name in cachedRecords) {
        if (!cachedRecords.hasOwnProperty(name)) {
            continue;
        }
        if (cachedRecords[name].expire <= now) {
            delete cachedRecords[name];
            continue;
        }
        nextCollection = Math.min(cachedRecords[name].expire, nextCollection);
    }
    nextGarbageCollection = 0;
    currentCollectionTimeout = null;
    if (isFinite(nextCollection)) {
        scheduleGarbageCollection(nextCollection);
    }
}

module.exports.setServers = function(servers) {
    dns.setServers(servers);
};

module.exports.getServers = function() {
    return dns.getServers();
};

//via: http://stackoverflow.com/questions/9716468/is-there-any-function-like-isnumeric-in-javascript-to-validate-numbers
//except we should allow infinity so there's no isFinite check
function isNumber(n) {
    return !isNaN(parseFloat(n));
}

/**
 * Lower priority means more preferred
 * Higher weight means more preferred
 *
 * First sort by priorities then sort by weights
 */
function compareTargets(a, b) {
    //if the one of them has a non-number priority then bail
    if (isNaN(a.priority) && !isNaN(b.priority)) {
        return 1;
    }
    if (isNaN(b.priority) || a.priority < b.priority) {
        //a is more preferred
        return -1;
    }
    if (b.priority < a.priority) {
        //b is more preferred
        return 1;
    }
    //at this point a.priority is equal to
    if (isNaN(a.weight)) {
        //if b.weight ALSO isn't a number then treat them equal
        return !isNaN(b.weight) ? 1 : 0;
    }
    if (isNaN(b.weight) || a.weight > b.weight) {
        //a is more preferred
        return -1;
    }
    if (b.weight > a.weight) {
        //b is more preferred
        return 1;
    }
    return 0;
}

function sortPriorityWeight(targets) {
    targets.sort(compareTargets);
}

function randomizeWeights(targets) {
    var totalWeights = 0,
        lastPriority = Infinity,
        i = 0,
        tmp = null;
    for (; i < targets.length; i++) {
        if (targets[i].priority !== lastPriority) {
            lastPriority = targets[i].priority;
            continue;
        }
        //todo: better handle weights that are not numbers
        if (isNaN(targets[i - 1].weight)) {
            //just flip the weight that is a number to before the non-number weight
            if (!isNaN(targets[i].weight)) {
                tmp = targets[i - 1];
                targets[i - 1] = targets[i];
                targets[i] = tmp;
            }
            continue;
        }
        //leave the previous numeric weight before the non-number
        if (isNaN(targets[i].weight)) {
            continue;
        }
        totalWeights = targets[i - 1].weight + targets[i].weight;
        //flip them randomly based on weight
        if ((Math.random() * totalWeights) > targets[i - 1].weight) {
            tmp = targets[i - 1];
            targets[i - 1] = targets[i];
            targets[i] = tmp;
        }
    }
}

function SRVTarget(result) {
    this.name = result.name || '';
    this.port = result.port || 0;
    this.priority = parseInt(result.priority, 10);
    this.weight = parseInt(result.weight, 10);
    this.address = result.address;
    this.addressFamily = net.isIP(this.address);
}
SRVTarget.prototype.resolve = function(cb) {
    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }
    if (this.address !== '' && this.addressFamily === 4) {
        cb(null, this.address);
        return;
    }
    dns.resolve4(this.name, function(err, addresses) {
        if (err) {
            cb(err, null);
            return;
        }
        this.address = addresses[0];
        this.addressFamily = 4;
        cb(null, this.address);
    }.bind(this));
};
SRVTarget.prototype.resolve4 = SRVTarget.prototype.resolve;
SRVTarget.prototype.resolve6 = function(cb) {
    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }
    if (this.address !== '' && this.addressFamily === 6) {
        cb(null, this.address);
        return;
    }
    dns.resolve6(this.name, function(err, addresses) {
        if (err) {
            cb(err, null);
            return;
        }
        this.address = addresses[0];
        this.addressFamily = 6;
        cb(null, this.address);
    }.bind(this));
};
SRVTarget.prototype.lookup = function(cb) {
    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }
    if (this.address !== '') {
        cb(null, this.address);
        return;
    }
    dns.lookup(this.name, function(err, address) {
        if (err) {
            cb(err, null);
            return;
        }
        this.address = address;
        this.addressFamily = net.isIP(address);
        cb(null, address);
    }.bind(this));
};

function wrapTargets(targets) {
    for (var i = 0; i < targets.length; i++) {
        targets[i] = new SRVTarget(targets[i]);
    }
    return targets;
}

function _lookup(hostname, server, callback) {
    var kv = {hostname: hostname, address: server.address},
        question, req;
    question = dns.Question({
        name: hostname,
        type: 'SRV'
    });
    req = dns.Request({
        question: question,
        server: server,
        timeout: dns.platform.timeout || 5000
    });
    req.on('timeout', function() {
        Log.warn('timed out talking to dns server', kv);
        callback(new Error('timeout waiting for dns response'), null);
    });
    req.on('message', function(err, answer) {
        if (err) {
            callback(err, null);
            return;
        }
        if (answer.header.rcode !== 0) {
            kv.rcode = answer.header.rcode;
            Log.debug('got non-zero rcode for request', kv);
            callback(new Error('DNS server returned error for ' + hostname + ': ' + dns.consts.RCODE_TO_NAME[answer.header.rcode]));
            return;
        }
        if (!answer.answer || answer.answer.length === 0) {
            Log.debug('got no answers but no error', kv);
            callback(new Error('DNS server returned no answers for ' + hostname + 'but no error'));
            return;
        }
        var cache = {};
        if (answer.additional) {
            answer.additional.forEach(function(a) {
                if (a.type === aType || a.type === aaaaType) {
                    cache[a.name] = a.address;
                }
            });
        }
        callback(null, answer.answer.filter(function(a) {
            return a.type === srvType;
        }).map(function(a) {
            return {
                name: a.target,
                port: a.port,
                weight: a.weight,
                priority: a.priority,
                address: cache[a.target]
            };
        }));
    });
    req.send();
}

function lookup(hostname, callback) {
    var index = 0,
        servers;
    if (!dns.platform.ready) {
        dns.platform.once('ready', function() {
            setImmediate(function() {
                lookup(hostname, callback);
            });
        });
        return;
    }
    servers = dns.platform.name_servers.slice(0, 3);
    if (servers.length < 1) {
        callback(new Error('no dns servers to use'), null);
        return;
    }
    (function call() {
        Log.debug('looking up SRV record', {hostname: hostname, address: servers[index].address});
        _lookup(hostname, servers[index], function(err, res) {
            if (err) {
                if (servers[index]) {
                    setImmediate(call);
                    return;
                }
            }
            callback(err, res);
        });
        index++;
    }())
}

function getTargets(options) {
    var hostname = options.hostname,
        callback = options.callback,
        cache = options.cache || 0,
        onlyFirst = options.single || false,
        sort = options.sort || sortPriorityWeight;
    if (typeof callback !== 'function') {
        if (typeof cache === 'function') {
            callback = cache;
            cache = 0;
        } else {
            throw new TypeError('callback must be a function');
        }
    }
    if (cache > 0) {
        if (!isNumber(cache)) {
            throw new TypeError('cache must be a number');
        }
        if (cachedRecords.hasOwnProperty(hostname) && cachedRecords[hostname].expire > Date.now()) {
            Log.debug('resolved SRV record from cache', {
                hostname: hostname
            });
            callback(null, (onlyFirst ? (cachedRecords[hostname].targets[0] || null) : cachedRecords[hostname].targets.slice()));
            return;
        }
    }
    lookup(hostname, function(err, targets) {
        if (err) {
            callback(err, null);
            return;
        }
        wrapTargets(targets);
        sort(targets);

        if (cache > 0 && targets.length) {
            cachedRecords[hostname] = {
                targets: targets,
                expire: Date.now() + cache
            };
            scheduleGarbageCollection(cachedRecords[hostname].expire);
            targets = targets.slice();
        }
        callback(null, (onlyFirst ? (targets[0] || null) : targets));
    })/*
    dns.resolveSrv(hostname, function(err, targets) {
        if (err || !Array.isArray(targets)) {
            callback(err, null);
            return;
        }

        wrapTargets(targets);
        sort(targets);

        if (cache > 0 && targets.length) {
            cachedRecords[hostname] = {
                targets: targets,
                expire: Date.now() + cache
            };
            scheduleGarbageCollection(cachedRecords[hostname].expire);
            targets = targets.slice();
        }
        callback(null, (onlyFirst ? (targets[0] || null) : targets));
    });*/
}

function getRandomTargets(options) {
    var callback = options.callback,
        onlyFirst = options.single || false;
    if (typeof callback !== 'function') {
        throw new TypeError('callback must be a function');
    }
    options.callback = function(err, targets) {
        if (err) {
            callback(err, null);
            return;
        }
        randomizeWeights(targets);
        callback(null, (onlyFirst ? (targets[0] || null) : targets));
    };
    // we need to always get back all the targets for randomizeWeights to work
    options.single = false;
    //if you passed another sort it won't work...
    if (options.hasOwnProperty('sort')) {
        throw new TypeError('random methods do not support a custom sort function');
    }
    return getTargets(options);
}

exports.getTargets = function(hostname, cache, callback) {
    if (typeof cache === 'function') {
        callback = cache;
        cache = 0;
    }
    return getTargets({
        hostname: hostname,
        cache: cache,
        callback: callback
    });
};

exports.getTarget = function(hostname, cache, callback) {
    if (typeof cache === 'function') {
        callback = cache;
        cache = 0;
    }
    return getTargets({
        hostname: hostname,
        cache: cache,
        callback: callback,
        single: true
    });
};

exports.getRandomTargets = function(hostname, cache, callback) {
    if (typeof cache === 'function') {
        callback = cache;
        cache = 0;
    }
    return getRandomTargets({
        hostname: hostname,
        cache: cache,
        callback: callback
    });
};

exports.getRandomTarget = function(hostname, cache, callback) {
    if (typeof cache === 'function') {
        callback = cache;
        cache = 0;
    }
    return getRandomTargets({
        hostname: hostname,
        cache: cache,
        callback: callback,
        single: true
    });
};

//mostly only available for tests
exports.sortTargets = function(targets) {
    targets.sort(compareTargets);
    return targets;
};


