/// <reference path="../pb_data/types.d.ts" />

routerAdd('GET', '/api/storage-stats', function (e) {
    var dataDir = $app.dataDir();

    try {
        if (dataDir.indexOf('/') !== 0) {
            dataDir = $filepath.join($os.getwd(), dataDir);
        }
    } catch (pathErr) {
        // relative pad behouden als getwd niet beschikbaar is
    }

    var result = {
        available: true,
        dataDir: dataDir,
        freeBytes: 0,
        totalBytes: 0,
        usedBytes: 0,
        usedPercent: 0,
        appDataBytes: 0,
    };

    var dfAttempts = [
        { args: ['df', '-B1', dataDir], blockSize: 1 },
        { args: ['df', '-Pk', dataDir], blockSize: 1024 },
        { args: ['df', '-kP', dataDir], blockSize: 1024 },
        { args: ['df', '-k', dataDir], blockSize: 1024 },
        { args: ['df', dataDir], blockSize: 1024 },
    ];

    var dfParsed = null;
    for (var i = 0; i < dfAttempts.length; i++) {
        var attempt = dfAttempts[i];
        try {
            var dfCmd = $os.cmd(attempt.args[0], attempt.args[1], attempt.args[2]);
            var dfRaw = toString(dfCmd.output());
            var dfLines = String(dfRaw || '').trim().split('\n');
            for (var li = 1; li < dfLines.length; li++) {
                var parts = dfLines[li].trim().split(/\s+/);
                if (parts.length < 5) continue;

                var fsName = parts[0];
                if (fsName === 'tmpfs' || fsName === 'devtmpfs' || fsName === 'proc' || fsName === 'sysfs') {
                    continue;
                }

                var total = parseInt(parts[1], 10);
                var used = parseInt(parts[2], 10);
                var avail = parseInt(parts[3], 10);
                var pcent = parseInt(String(parts[4]).replace('%', ''), 10);
                if (!total || isNaN(total)) continue;

                dfParsed = {
                    totalBytes: total * attempt.blockSize,
                    usedBytes: used * attempt.blockSize,
                    freeBytes: avail * attempt.blockSize,
                    usedPercent: isNaN(pcent) ? Math.round((used / total) * 100) : pcent,
                };
                break;
            }
            if (dfParsed) break;
        } catch (dfErr) {
            // volgende df-variant proberen
        }
    }

    if (!dfParsed) {
        return e.json(503, {
            available: false,
            error: 'Opslag meten mislukt (df)',
            dataDir: dataDir,
        });
    }

    result.totalBytes = dfParsed.totalBytes;
    result.usedBytes = dfParsed.usedBytes;
    result.freeBytes = dfParsed.freeBytes;
    result.usedPercent = dfParsed.usedPercent;

    var duAttempts = [
        { args: ['du', '-sb', dataDir], multiplier: 1 },
        { args: ['du', '-sk', dataDir], multiplier: 1024 },
        { args: ['du', '-s', dataDir], multiplier: 1024 },
    ];

    for (var di = 0; di < duAttempts.length; di++) {
        var duAttempt = duAttempts[di];
        try {
            var duCmd = $os.cmd(duAttempt.args[0], duAttempt.args[1], duAttempt.args[2]);
            var duRaw = toString(duCmd.output()).trim();
            var duNum = parseInt(duRaw.split(/\s+/)[0], 10);
            if (duNum && !isNaN(duNum)) {
                result.appDataBytes = duNum * duAttempt.multiplier;
                break;
            }
        } catch (duErr) {
            // optioneel
        }
    }

    return e.json(200, result);
});
