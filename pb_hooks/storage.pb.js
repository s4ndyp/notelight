/// <reference path="../pb_data/types.d.ts" />

routerAdd('GET', '/api/storage-stats', function (e) {
    var dataDir = $app.dataDir();
    var result = {
        available: true,
        dataDir: dataDir,
        freeBytes: 0,
        totalBytes: 0,
        usedBytes: 0,
        usedPercent: 0,
        appDataBytes: 0,
    };

    try {
        var dfCmd = $os.cmd('df', '-B1', dataDir);
        var dfRaw = toString(dfCmd.output());
        var dfLines = dfRaw.trim().split('\n');
        if (dfLines.length >= 2) {
            var parts = dfLines[1].trim().split(/\s+/);
            if (parts.length >= 5) {
                result.totalBytes = parseInt(parts[1], 10) || 0;
                result.usedBytes = parseInt(parts[2], 10) || 0;
                result.freeBytes = parseInt(parts[3], 10) || 0;
                result.usedPercent = parseInt(String(parts[4]).replace('%', ''), 10) || 0;
            }
        }
    } catch (err) {
        return e.json(503, {
            available: false,
            error: 'Opslag meten mislukt',
        });
    }

    if (!result.totalBytes) {
        return e.json(503, {
            available: false,
            error: 'Opslag meten mislukt',
        });
    }

    try {
        var duCmd = $os.cmd('du', '-sb', dataDir);
        var duRaw = toString(duCmd.output()).trim();
        var duParts = duRaw.split(/\s+/);
        if (duParts.length >= 1) {
            result.appDataBytes = parseInt(duParts[0], 10) || 0;
        }
    } catch (err) {
        // du is optioneel; df-resultaat is voldoende voor de indicator
    }

    return e.json(200, result);
});
