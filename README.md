# srvclient #

A simple library for getting SRV DNS targets from something like SkyDNS.

### Usage ###

```JS
var srv = require('srvclient');
```

## Methods ##

### srv.setServers(servers) ###

Set the DNS servers to use for resolution. Identical to [dns.setServers](https://nodejs.org/api/dns.html#dns_dns_setservers_servers)

### srv.getTargets(hostname, callback) ###
### srv.getTargets(hostname, cache, callback) ###

Gets an array of targets for `hostname` weighted by lowest priority and highest weight. `callback`
is called with `(err, targets)` where targets is an array of `SRVTarget`s. `cache` is the number
of milliseconds to cache the result.

### srv.getTarget(hostname, callback) ###
### srv.getTarget(hostname, cache, callback) ###

Exactly like `srv.getTargets` except the first `SRVTarget` is sent to callback instead of an array.

### srv.getRandomTargets(hostname, callback) ###
### srv.getRandomTargets(hostname, cache, callback) ###

Exactly like `srv.getTargets` except the array of targets is ordered by priority first and then
weighted randomly.

### srv.getRandomTarget(hostname, callback) ###
### srv.getRandomTarget(hostname, cache, callback) ###

Exactly like `srv.getRandomTargets` except the first `SRVTarget` is sent to callback instead of
an array.

## SRVTarget ##

### srv.name ###

The hostname of the target.

### srv.port ###

The port of the target.

### srv.resolve(callback) ###
### srv.resolve4(callback) ###

Resolves the target to an IPv4 address. `callback` is called with `(err, address)`. The result is
cached for the life of the target.

### srv.resolve6(callback) ###

Resolves the target to an IPv6 address. `callback` is called with `(err, address)`. The result is
cached for the life of the target.

### srv.setPreprocessor(fn) ###

Sets a function that runs on a list of resolved targets. The function receives an array of
unsorted targets and must return an array of targets to be sorted. The targets are cached after
the preprocessor runs and therefore the preprocessor does not run when cache is hit.
