/**
 * Notelight feature extensions:
 * - Meer laden (paginatie)
 * - CSV-export
 * - Deep links (?id=)
 * - Centrale keuzelijsten (+ toevoegen)
 * - Voorkeuren sync via PocketBase
 *
 * Verwacht window.NotelightCore met gedeelde state/helpers uit index.html.
 */
(function () {
    const PAGE_SIZE = 50;
    const KEUZE_COLLECTION = 'keuzelijsten';
    const VOORKEUR_COLLECTION = 'voorkeuren';
    const VOORKEUR_KEY = 'team';
    const CHOICE_CATEGORIES = [
        { id: 'status', label: 'Status', allowEmpty: false },
        { id: 'soort', label: 'Soort', allowEmpty: false },
        { id: 'kenmerk', label: 'Kenmerk', allowEmpty: true },
        { id: 'dataset', label: 'Dataset', allowEmpty: true },
        { id: 'betrokkene', label: 'Betrokkene', allowEmpty: true },
    ];
    const DEFAULT_STATUS_VALUES = [
        'Nieuw',
        'In uitvoering',
        'Wachtend',
        'Afgerond',
        'Ter info',
        'Archief',
    ];

    function core() {
        return window.NotelightCore;
    }

    function ensurePaginationState(state) {
        if (state.page == null) state.page = 1;
        if (state.pageSize == null) state.pageSize = PAGE_SIZE;
        if (state.totalItems == null) state.totalItems = 0;
        if (state.hasMore == null) state.hasMore = false;
        if (state.loadingMore == null) state.loadingMore = false;
        if (!state.keuzelijsten) {
            state.keuzelijsten = {
                available: false,
                items: [],
                byCategorie: {},
            };
        }
        if (!state.voorkeuren) {
            state.voorkeuren = {
                available: false,
                recordId: null,
                syncTimer: null,
                ready: false,
            };
        }
    }

    function buildApiFilter(state) {
        const apiFilter = [];

        if (state.searchQuery) {
            const term = state.searchQuery.replace(/"/g, '\\"');
            apiFilter.push(
                `(titel ~ "${term}" || omschrijving ~ "${term}" || soort ~ "${term}" || kenmerk ~ "${term}" || dataset ~ "${term}" || betrokkene ~ "${term}")`
            );
        }

        state.savedFilters
            .filter((f) => state.activeSavedFilterIds.includes(f.id))
            .forEach((f) => apiFilter.push(`(${f.filter})`));

        if (state.activeFilterStr) {
            apiFilter.push(`(${state.activeFilterStr})`);
        }

        return apiFilter.join(' && ');
    }

    function updateLoadMoreUi(state) {
        const bar = document.getElementById('load-more-bar');
        const summary = document.getElementById('load-more-summary');
        const btn = document.getElementById('btn-load-more');
        if (!bar || !summary || !btn) return;

        const shown = state.records.length;
        const total = state.totalItems || 0;
        summary.textContent =
            total > 0
                ? `${shown} van ${total} record${total === 1 ? '' : 's'} geladen`
                : '';

        const showBar = total > 0 && (state.hasMore || shown > 0);
        bar.classList.toggle('hidden', !showBar || shown === 0);
        btn.classList.toggle('hidden', !state.hasMore);
        btn.disabled = !!state.loadingMore;
        btn.textContent = state.loadingMore ? 'Laden...' : 'Meer laden';
    }

    function withFallbackSort(options, fallbackSort) {
        const next = { ...options };
        if (fallbackSort) next.sort = fallbackSort;
        else delete next.sort;
        return next;
    }

    async function getListSafe(pb, collection, page, perPage, options) {
        try {
            return await pb.collection(collection).getList(page, perPage, options);
        } catch (error) {
            if (!options?.sort) throw error;
            // Older/custom schemas may miss autodate fields like created/updated.
            console.warn('Sort mislukt, probeer fallback:', options.sort, error);
            try {
                return await pb
                    .collection(collection)
                    .getList(page, perPage, withFallbackSort(options, '-id'));
            } catch (error2) {
                return await pb
                    .collection(collection)
                    .getList(page, perPage, withFallbackSort(options, null));
            }
        }
    }

    async function getFullListSafe(pb, collection, options) {
        try {
            return await pb.collection(collection).getFullList(options);
        } catch (error) {
            if (!options?.sort) throw error;
            console.warn('Sort mislukt bij full list, probeer fallback:', options.sort, error);
            try {
                return await pb.collection(collection).getFullList(withFallbackSort(options, '-id'));
            } catch (error2) {
                return await pb.collection(collection).getFullList(withFallbackSort(options, null));
            }
        }
    }

    async function fetchDataEnhanced({ append = false, showOverlay = true } = {}) {
        const c = core();
        if (!c?.pb) {
            c?.showToast?.('Fout', 'PocketBase niet gevonden. Controleer verbinding.', 'error');
            return;
        }

        const { state, pb, COLLECTION_NAME, loadingOverlay } = c;
        ensurePaginationState(state);

        if (state.loadingMore && append) return;

        if (!append) {
            state.page = 1;
            state.loadingMore = false;
        } else {
            if (!state.hasMore) return;
            state.loadingMore = true;
            state.page += 1;
        }

        if (showOverlay && !append) loadingOverlay?.classList.remove('hidden');
        updateLoadMoreUi(state);

        try {
            const finalFilter = buildApiFilter(state);
            const sortPrefix = state.sortDirection === 'desc' ? '-' : '';
            const listOptions = {
                sort: `${sortPrefix}${state.sortField}`,
                requestKey: null,
            };
            if (finalFilter) listOptions.filter = finalFilter;

            const resultList = await getListSafe(
                pb,
                COLLECTION_NAME,
                state.page,
                state.pageSize,
                listOptions
            );

            state.totalItems = resultList.totalItems;
            state.hasMore = resultList.page < resultList.totalPages;

            const pinnedRecords = append
                ? []
                : await c.fetchPinnedRecords(finalFilter);

            if (append) {
                const existingIds = new Set(state.records.map((r) => r.id));
                const fresh = resultList.items.filter((r) => !existingIds.has(r.id));
                state.records = [...state.records, ...fresh];
            } else {
                state.records = c.mergeRecordsWithPins(resultList.items, pinnedRecords);
            }

            c.renderTable();
            updateLoadMoreUi(state);
        } catch (error) {
            if (error?.isAbort) return;
            console.error('Fetch error:', error);
            if (append) {
                state.page = Math.max(1, state.page - 1);
            }
            if (error.status === 0) {
                c.showToast(
                    'Verbindingsfout',
                    `Kan PocketBase niet bereiken op ${c.PB_URL}. Draait de server?`,
                    'error'
                );
            } else if (error.status === 404) {
                c.showToast(
                    'Fout',
                    `Collectie '${COLLECTION_NAME}' bestaat niet. Maak deze aan in PocketBase.`,
                    'error'
                );
            } else {
                c.showToast('Fout', 'Fout bij ophalen gegevens: ' + error.message, 'error');
            }
        } finally {
            state.loadingMore = false;
            if (showOverlay && !append) loadingOverlay?.classList.add('hidden');
            updateLoadMoreUi(state);
        }
    }

    function csvEscape(value) {
        const str = value == null ? '' : String(value);
        if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
        return str;
    }

    async function exportFilteredCsv() {
        const c = core();
        if (!c?.pb) return;

        const { state, pb, COLLECTION_NAME, showToast } = c;
        const btn = document.getElementById('btn-export');
        if (btn) btn.disabled = true;

        try {
            const finalFilter = buildApiFilter(state);
            const sortPrefix = state.sortDirection === 'desc' ? '-' : '';
            const options = {
                sort: `${sortPrefix}${state.sortField}`,
                requestKey: null,
            };
            if (finalFilter) options.filter = finalFilter;

            const items = await getFullListSafe(pb, COLLECTION_NAME, options);
            const exportCols = (state.columns || []).filter((col) => col.visible);
            if (!exportCols.length) {
                showToast('Export', 'Geen kolommen geselecteerd voor weergave.', 'error');
                return;
            }

            const headers = exportCols.map((col) => col.label || col.id);
            const keys = exportCols.map((col) => col.id);

            const rows = items.map((record) =>
                keys
                    .map((key) => {
                        if (key === 'bijlage') {
                            const files = Array.isArray(record.bijlage)
                                ? record.bijlage
                                : record.bijlage
                                  ? [record.bijlage]
                                  : [];
                            return csvEscape(files.join('; '));
                        }
                        return csvEscape(record[key] ?? '');
                    })
                    .join(',')
            );

            const csv = `\uFEFF${headers.map(csvEscape).join(',')}\n${rows.join('\n')}`;
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            a.href = url;
            a.download = `notelight-export-${stamp}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast(
                'Export klaar',
                `${items.length} record${items.length === 1 ? '' : 's'} · ${exportCols.length} kolom${exportCols.length === 1 ? '' : 'men'} geëxporteerd (CSV/Excel).`,
                'success'
            );
        } catch (error) {
            console.error(error);
            c.showToast('Fout', 'Exporteren mislukt: ' + (error.message || error), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function appPathname() {
        // PocketBase redirects /index.html -> / and drops the query string.
        // Always use "/" (or directory path) for shareable deep links.
        let path = window.location.pathname || '/';
        if (path.endsWith('/index.html')) {
            path = path.slice(0, -'index.html'.length) || '/';
        }
        if (!path.endsWith('/')) {
            // keep directory URLs as-is; root stays "/"
            if (path === '') path = '/';
        }
        return path === '' ? '/' : path;
    }

    function setRecordUrl(id) {
        const url = new URL(window.location.href);
        url.pathname = appPathname();
        if (id) url.searchParams.set('id', id);
        else url.searchParams.delete('id');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    async function openRecordFromUrl() {
        const c = core();
        if (!c?.pb) return;

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        if (!id) return;
        // Normalize URL away from /index.html so later edits keep the id.
        setRecordUrl(id);

        try {
            const existing = c.state.records.find((r) => r.id === id);
            if (existing) {
                c.loadRecordForEdit(existing);
                return;
            }
            const record = await c.pb.collection(c.COLLECTION_NAME).getOne(id);
            c.loadRecordForEdit(record);
        } catch (error) {
            console.warn('Deep link record niet gevonden:', error);
            c.showToast('Niet gevonden', 'Record uit de link bestaat niet (meer).', 'error');
            setRecordUrl(null);
        }
    }

    function ensureSelectHasValue(select, value) {
        if (!select || value == null) return;
        const str = String(value);
        if (!str) {
            select.value = '';
            return;
        }
        const exists = Array.from(select.options).some((opt) => opt.value === str);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = str;
            opt.textContent = str;
            opt.dataset.orphan = '1';
            select.appendChild(opt);
        }
        select.value = str;
    }

    function getChoicesFor(categorie) {
        const c = core();
        ensurePaginationState(c.state);
        return c.state.keuzelijsten.byCategorie[categorie] || [];
    }

    function renderChoiceSelects() {
        const c = core();
        ensurePaginationState(c.state);

        CHOICE_CATEGORIES.forEach(({ id, allowEmpty, label }) => {
            const select = document.getElementById(`input-${id}`);
            if (!select || select.tagName !== 'SELECT') return;

            const current = select.value;
            const values = getChoicesFor(id).map((item) => item.waarde);

            let fallback = values;
            if (id === 'status' && fallback.length === 0) {
                fallback = DEFAULT_STATUS_VALUES.slice();
            }

            select.innerHTML = '';
            if (allowEmpty) {
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = `— ${label} —`;
                select.appendChild(empty);
            } else if (id === 'soort') {
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = '— Kies soort —';
                select.appendChild(empty);
            }

            fallback.forEach((value) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = value;
                select.appendChild(opt);
            });

            if (current) ensureSelectHasValue(select, current);
            else if (id === 'status') select.value = 'Nieuw';
            else select.value = '';
        });

        c.syncColoredFormFields?.();
    }

    async function loadKeuzelijsten({ seedFromRecords = true } = {}) {
        const c = core();
        if (!c?.pb) return;
        ensurePaginationState(c.state);

        try {
            const items = await c.pb.collection(KEUZE_COLLECTION).getFullList({
                sort: 'categorie,waarde',
                requestKey: null,
            });
            c.state.keuzelijsten.available = true;
            c.state.keuzelijsten.items = items;
            c.state.keuzelijsten.byCategorie = {};
            CHOICE_CATEGORIES.forEach(({ id }) => {
                c.state.keuzelijsten.byCategorie[id] = [];
            });
            items.forEach((item) => {
                const cat = item.categorie;
                if (!c.state.keuzelijsten.byCategorie[cat]) {
                    c.state.keuzelijsten.byCategorie[cat] = [];
                }
                c.state.keuzelijsten.byCategorie[cat].push(item);
            });

            if (seedFromRecords) {
                await seedMissingChoicesFromRecords();
            }

            renderChoiceSelects();
            renderKeuzelijstenModal();
        } catch (error) {
            c.state.keuzelijsten.available = false;
            if (error?.status === 404) {
                console.warn(
                    `Collectie '${KEUZE_COLLECTION}' ontbreekt. Lokale keuzes uit registraties worden gebruikt tot je die aanmaakt.`
                );
            } else {
                console.warn('Keuzelijsten laden mislukt:', error);
            }
            await hydrateLocalChoicesFromRecords();
            renderChoiceSelects();
        }
    }

    async function hydrateLocalChoicesFromRecords() {
        const c = core();
        ensurePaginationState(c.state);
        CHOICE_CATEGORIES.forEach(({ id }) => {
            c.state.keuzelijsten.byCategorie[id] = c.state.keuzelijsten.byCategorie[id] || [];
        });
        DEFAULT_STATUS_VALUES.forEach((waarde) => {
            const list = c.state.keuzelijsten.byCategorie.status;
            if (!list.some((item) => item.waarde === waarde)) {
                list.push({ id: `local-status-${waarde}`, waarde, categorie: 'status' });
            }
        });
        try {
            const records = await c.pb.collection(c.COLLECTION_NAME).getFullList({
                requestKey: null,
            });
            ['soort', 'kenmerk', 'dataset', 'betrokkene', 'status'].forEach((cat) => {
                const list = c.state.keuzelijsten.byCategorie[cat] || [];
                c.state.keuzelijsten.byCategorie[cat] = list;
                const seen = new Set(list.map((item) => item.waarde.trim().toLowerCase()));
                records.forEach((record) => {
                    const waarde = String(record[cat] || '').trim();
                    if (!waarde) return;
                    const key = waarde.toLowerCase();
                    if (seen.has(key)) return;
                    seen.add(key);
                    list.push({ id: `local-${cat}-${key}`, waarde, categorie: cat });
                });
            });
        } catch (error) {
            console.warn('Lokale keuzes vullen mislukt:', error);
        }
    }

    async function seedMissingChoicesFromRecords() {
        const c = core();
        if (!c.state.keuzelijsten.available) return;

        const existing = new Set(
            c.state.keuzelijsten.items.map(
                (item) => `${item.categorie}::${String(item.waarde || '').trim().toLowerCase()}`
            )
        );

        const toCreate = [];

        DEFAULT_STATUS_VALUES.forEach((waarde) => {
            const key = `status::${waarde.toLowerCase()}`;
            if (!existing.has(key)) {
                toCreate.push({ categorie: 'status', waarde });
                existing.add(key);
            }
        });

        try {
            const records = await c.pb.collection(c.COLLECTION_NAME).getFullList({
                requestKey: null,
            });
            ['soort', 'kenmerk', 'dataset', 'betrokkene', 'status'].forEach((cat) => {
                records.forEach((record) => {
                    const waarde = String(record[cat] || '').trim();
                    if (!waarde) return;
                    const key = `${cat}::${waarde.toLowerCase()}`;
                    if (existing.has(key)) return;
                    toCreate.push({ categorie: cat, waarde });
                    existing.add(key);
                });
            });
        } catch (error) {
            console.warn('Seed vanuit registraties overgeslagen:', error);
        }

        for (const payload of toCreate) {
            try {
                await c.pb.collection(KEUZE_COLLECTION).create(payload);
            } catch (error) {
                console.warn('Keuze seed mislukt:', payload, error);
            }
        }

        if (toCreate.length) {
            const items = await c.pb.collection(KEUZE_COLLECTION).getFullList({
                sort: 'categorie,waarde',
                requestKey: null,
            });
            c.state.keuzelijsten.items = items;
            c.state.keuzelijsten.byCategorie = {};
            CHOICE_CATEGORIES.forEach(({ id }) => {
                c.state.keuzelijsten.byCategorie[id] = [];
            });
            items.forEach((item) => {
                const cat = item.categorie;
                if (!c.state.keuzelijsten.byCategorie[cat]) {
                    c.state.keuzelijsten.byCategorie[cat] = [];
                }
                c.state.keuzelijsten.byCategorie[cat].push(item);
            });
        }
    }

    async function addKeuze(categorie, waarde, { selectAfter = true } = {}) {
        const c = core();
        const clean = String(waarde || '').trim();
        if (!clean) return null;

        const exists = getChoicesFor(categorie).some(
            (item) => item.waarde.trim().toLowerCase() === clean.toLowerCase()
        );
        if (exists) {
            if (selectAfter) {
                ensureSelectHasValue(document.getElementById(`input-${categorie}`), clean);
                c.syncColoredFormFields?.();
            }
            c.showToast('Bestaat al', `"${clean}" staat al in de lijst.`, 'success');
            return null;
        }

        if (!c.state.keuzelijsten.available) {
            ensurePaginationState(c.state);
            if (!c.state.keuzelijsten.byCategorie[categorie]) {
                c.state.keuzelijsten.byCategorie[categorie] = [];
            }
            c.state.keuzelijsten.byCategorie[categorie].push({
                id: `local-${categorie}-${Date.now()}`,
                waarde: clean,
                categorie,
            });
            renderChoiceSelects();
            if (selectAfter) {
                ensureSelectHasValue(document.getElementById(`input-${categorie}`), clean);
                c.syncColoredFormFields?.();
            }
            c.showToast(
                'Tijdelijk toegevoegd',
                `"${clean}" staat in deze browser. Maak collectie '${KEUZE_COLLECTION}' aan voor centraal beheer.`,
                'success'
            );
            return null;
        }

        try {
            const created = await c.pb.collection(KEUZE_COLLECTION).create({
                categorie,
                waarde: clean,
            });
            await loadKeuzelijsten({ seedFromRecords: false });
            if (selectAfter) {
                ensureSelectHasValue(document.getElementById(`input-${categorie}`), clean);
                c.syncColoredFormFields?.();
            }
            c.showToast('Toegevoegd', `"${clean}" is toegevoegd aan ${categorie}.`, 'success');
            return created;
        } catch (error) {
            c.showToast('Fout', 'Keuze toevoegen mislukt: ' + (error.message || error), 'error');
            return null;
        }
    }

    async function deleteKeuze(id) {
        const c = core();
        if (!c.state.keuzelijsten.available) return;
        try {
            await c.pb.collection(KEUZE_COLLECTION).delete(id);
            await loadKeuzelijsten({ seedFromRecords: false });
            c.showToast('Verwijderd', 'Keuze is verwijderd uit de centrale lijst.', 'success');
        } catch (error) {
            c.showToast('Fout', 'Verwijderen mislukt: ' + (error.message || error), 'error');
        }
    }

    function ensureChoicePromptModal() {
        let modal = document.getElementById('choice-add-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'choice-add-modal';
        modal.className = 'modal-backdrop hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-panel" style="width:min(28rem,100%);max-height:none;">
                <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-800">
                    <h2 id="choice-add-title" class="text-lg font-semibold text-white">Nieuwe keuze</h2>
                    <button type="button" id="choice-add-close" class="text-gray-500 hover:text-white transition-colors p-1" title="Sluiten">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="choice-add-form" class="p-5 space-y-3">
                    <label class="block text-sm text-gray-300" for="choice-add-input">Waarde</label>
                    <input id="choice-add-input" type="text" required autocomplete="off" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nieuwe waarde...">
                    <div class="flex gap-2 pt-1">
                        <button type="button" id="choice-add-cancel" class="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm py-2 rounded-lg">Annuleren</button>
                        <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded-lg">Toevoegen</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);

        const close = () => {
            modal.classList.add('hidden');
            modal.dataset.categorie = '';
        };
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#choice-add-close').addEventListener('click', close);
        modal.querySelector('#choice-add-cancel').addEventListener('click', close);
        modal.querySelector('#choice-add-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const categorie = modal.dataset.categorie;
            const value = modal.querySelector('#choice-add-input').value;
            close();
            if (categorie) addKeuze(categorie, value, { selectAfter: true });
        });
        return modal;
    }

    function promptAddKeuze(categorie) {
        const meta = CHOICE_CATEGORIES.find((item) => item.id === categorie);
        const label = meta?.label || categorie;
        const modal = ensureChoicePromptModal();
        modal.dataset.categorie = categorie;
        modal.querySelector('#choice-add-title').textContent = `Nieuwe ${label.toLowerCase()}`;
        const input = modal.querySelector('#choice-add-input');
        input.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
    }

    function renderKeuzelijstenModal() {
        const body = document.getElementById('keuzelijsten-body');
        if (!body) return;
        const c = core();
        ensurePaginationState(c.state);

        if (!c.state.keuzelijsten.available) {
            body.innerHTML = `
                <div class="text-sm text-gray-400 space-y-2">
                    <p>De collectie <code class="text-blue-400">${KEUZE_COLLECTION}</code> bestaat nog niet.</p>
                    <p>Maak die aan in PocketBase Admin volgens de README. Daarna kun je hier keuzes centraal beheren, en via <strong class="text-gray-200">+</strong> nieuwe waarden toevoegen.</p>
                </div>`;
            return;
        }

        body.innerHTML = CHOICE_CATEGORIES.map(({ id, label }) => {
            const items = getChoicesFor(id);
            const list =
                items.length === 0
                    ? `<p class="text-xs text-gray-500 italic">Nog geen waarden</p>`
                    : items
                          .map(
                              (item) => `
                        <div class="keuze-item">
                            <span class="text-sm text-gray-200 truncate" title="${c.escapeAttr(item.waarde)}">${c.escapeAttr(item.waarde)}</span>
                            <button type="button" class="text-xs text-red-400 hover:text-red-300" data-delete-keuze="${item.id}">Verwijder</button>
                        </div>`
                          )
                          .join('');

            return `
                <section class="keuze-cat-block">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <h3 class="text-sm font-medium text-white">${label}</h3>
                        <button type="button" class="text-xs text-blue-400 hover:text-blue-300" data-add-keuze="${id}">+ Toevoegen</button>
                    </div>
                    ${list}
                </section>`;
        }).join('');
    }

    function openKeuzelijstenModal() {
        renderKeuzelijstenModal();
        document.getElementById('keuzelijsten-modal')?.classList.remove('hidden');
    }

    function closeKeuzelijstenModal() {
        document.getElementById('keuzelijsten-modal')?.classList.add('hidden');
    }

    function collectPrefsPayload(state) {
        const columns = {};
        state.columns.forEach((col) => {
            columns[col.id] = col.visible;
        });
        return {
            savedFilters: state.savedFilters,
            activeSavedFilterIds: state.activeSavedFilterIds,
            pinnedRecordIds: state.pinnedRecordIds,
            columns,
            columnWidths: state.columnWidths || {},
            sort: {
                field: state.sortField,
                direction: state.sortDirection,
            },
        };
    }

    function applyPrefsPayload(state, data) {
        if (!data || typeof data !== 'object') return;

        if (Array.isArray(data.savedFilters)) {
            state.savedFilters = data.savedFilters.map((f, i) => ({
                id: f.id || `sf-${Date.now()}-${i}`,
                name: f.name,
                filter: f.filter,
            }));
        }
        if (Array.isArray(data.activeSavedFilterIds)) {
            state.activeSavedFilterIds = data.activeSavedFilterIds;
        }
        if (Array.isArray(data.pinnedRecordIds)) {
            state.pinnedRecordIds = data.pinnedRecordIds;
        }
        if (data.columns && typeof data.columns === 'object') {
            state.columns.forEach((col) => {
                if (data.columns[col.id] !== undefined) col.visible = data.columns[col.id];
            });
        }
        if (data.columnWidths && typeof data.columnWidths === 'object') {
            state.columnWidths = { ...(state.columnWidths || {}), ...data.columnWidths };
        }
        if (data.sort?.field) state.sortField = data.sort.field;
        if (data.sort?.direction) state.sortDirection = data.sort.direction;

        const validFilterIds = new Set(state.savedFilters.map((f) => f.id));
        state.activeSavedFilterIds = state.activeSavedFilterIds.filter((id) =>
            validFilterIds.has(id)
        );
    }

    function mirrorPrefsToLocal(state) {
        localStorage.setItem('pbApp_savedFilters', JSON.stringify(state.savedFilters));
        localStorage.setItem(
            'pbApp_activeSavedFilterIds',
            JSON.stringify(state.activeSavedFilterIds)
        );
        localStorage.setItem('pbApp_pinnedRecordIds', JSON.stringify(state.pinnedRecordIds));
        const columns = {};
        state.columns.forEach((col) => {
            columns[col.id] = col.visible;
        });
        localStorage.setItem('pbApp_columns', JSON.stringify(columns));
        localStorage.setItem('pbApp_columnWidths_v2', JSON.stringify(state.columnWidths || {}));
        localStorage.setItem(
            'pbApp_sort',
            JSON.stringify({ field: state.sortField, direction: state.sortDirection })
        );
    }

    async function loadVoorkeuren() {
        const c = core();
        if (!c?.pb) return;
        ensurePaginationState(c.state);

        try {
            const list = await c.pb.collection(VOORKEUR_COLLECTION).getList(1, 1, {
                filter: `sleutel="${VOORKEUR_KEY}"`,
                requestKey: null,
            });
            c.state.voorkeuren.available = true;

            if (list.items.length) {
                const record = list.items[0];
                c.state.voorkeuren.recordId = record.id;
                let data = record.data;
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (_) {
                        data = {};
                    }
                }
                applyPrefsPayload(c.state, data || {});
                mirrorPrefsToLocal(c.state);
            } else {
                const payload = collectPrefsPayload(c.state);
                const created = await c.pb.collection(VOORKEUR_COLLECTION).create({
                    sleutel: VOORKEUR_KEY,
                    data: payload,
                });
                c.state.voorkeuren.recordId = created.id;
            }
        } catch (error) {
            c.state.voorkeuren.available = false;
            if (error?.status === 404) {
                console.warn(
                    `Collectie '${VOORKEUR_COLLECTION}' ontbreekt; voorkeuren blijven lokaal (localStorage).`
                );
            } else {
                console.warn('Voorkeuren laden mislukt:', error);
            }
        } finally {
            c.state.voorkeuren.ready = true;
        }
    }

    function scheduleVoorkeurenSync() {
        const c = core();
        ensurePaginationState(c.state);
        mirrorPrefsToLocal(c.state);

        if (!c.state.voorkeuren.available || !c.state.voorkeuren.ready) return;

        clearTimeout(c.state.voorkeuren.syncTimer);
        c.state.voorkeuren.syncTimer = setTimeout(async () => {
            try {
                const payload = {
                    sleutel: VOORKEUR_KEY,
                    data: collectPrefsPayload(c.state),
                };
                if (c.state.voorkeuren.recordId) {
                    await c.pb
                        .collection(VOORKEUR_COLLECTION)
                        .update(c.state.voorkeuren.recordId, payload);
                } else {
                    const created = await c.pb.collection(VOORKEUR_COLLECTION).create(payload);
                    c.state.voorkeuren.recordId = created.id;
                }
            } catch (error) {
                console.warn('Voorkeuren sync mislukt:', error);
            }
        }, 400);
    }

    function wireUi() {
        const c = core();
        document.getElementById('btn-load-more')?.addEventListener('click', () => {
            fetchDataEnhanced({ append: true, showOverlay: false });
        });
        document.getElementById('btn-export')?.addEventListener('click', exportFilteredCsv);
        document.getElementById('btn-keuzelijsten')?.addEventListener('click', openKeuzelijstenModal);
        document
            .getElementById('btn-keuzelijsten-close')
            ?.addEventListener('click', closeKeuzelijstenModal);
        document.getElementById('keuzelijsten-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'keuzelijsten-modal') closeKeuzelijstenModal();
        });
        document.getElementById('keuzelijsten-body')?.addEventListener('click', (e) => {
            const addBtn = e.target.closest('[data-add-keuze]');
            if (addBtn) {
                promptAddKeuze(addBtn.dataset.addKeuze);
                return;
            }
            const delBtn = e.target.closest('[data-delete-keuze]');
            if (delBtn) {
                if (!c.confirmAction('Deze keuze uit de centrale lijst verwijderen?')) return;
                deleteKeuze(delBtn.dataset.deleteKeuze);
            }
        });
        document.querySelectorAll('.btn-choice-add').forEach((btn) => {
            btn.addEventListener('click', () => promptAddKeuze(btn.dataset.categorie));
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeKeuzelijstenModal();
        });
    }

    window.NotelightFeatures = {
        PAGE_SIZE,
        ensurePaginationState,
        fetchDataEnhanced,
        exportFilteredCsv,
        setRecordUrl,
        openRecordFromUrl,
        ensureSelectHasValue,
        loadKeuzelijsten,
        renderChoiceSelects,
        addKeuze,
        promptAddKeuze,
        openKeuzelijstenModal,
        closeKeuzelijstenModal,
        loadVoorkeuren,
        scheduleVoorkeurenSync,
        updateLoadMoreUi,
        wireUi,
        CHOICE_CATEGORIES,
    };
})();
