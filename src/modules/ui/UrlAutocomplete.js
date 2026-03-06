export class UrlAutocomplete {
    constructor(urlInputElement, historyController) {
        this.urlInput = urlInputElement;
        this.historyController = historyController;
        this.dropdown = null;
        this.suggestions = [];
        this.activeIndex = -1;
        this._debounceTimer = null;
    }

    init() {
        this._createDOM();
        this._attachListeners();
    }

    _createDOM() {
        // Wrap the urlInput in a relative-positioned div so dropdown can anchor to it
        const wrapper = document.createElement('div');
        wrapper.className = 'url-autocomplete-wrapper';
        this.urlInput.parentNode.insertBefore(wrapper, this.urlInput);
        wrapper.appendChild(this.urlInput);

        this.dropdown = document.createElement('ul');
        this.dropdown.className = 'url-autocomplete-dropdown';
        this.dropdown.setAttribute('role', 'listbox');
        wrapper.appendChild(this.dropdown);
    }

    _attachListeners() {
        // Show recents on focus when field is empty
        this.urlInput.addEventListener('focus', async () => {
            if (!this.urlInput.value.trim()) {
                await this._showSuggestions('');
            }
        });

        // Debounced input handler
        this.urlInput.addEventListener('input', () => {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(async () => {
                await this._showSuggestions(this.urlInput.value);
            }, 150);
        });

        // Keyboard navigation
        this.urlInput.addEventListener('keydown', (e) => {
            if (!this._isVisible()) { return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._setActive(Math.min(this.activeIndex + 1, this.suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._setActive(Math.max(this.activeIndex - 1, -1));
            } else if (e.key === 'Enter' && this.activeIndex >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation(); // don't trigger send
                this._select(this.suggestions[this.activeIndex]);
            } else if (e.key === 'Escape') {
                this._hide();
            }
        });

        // Hide on blur (delay to allow mousedown on item to fire first)
        this.urlInput.addEventListener('blur', () => {
            setTimeout(() => this._hide(), 150);
        });
    }

    async _showSuggestions(query) {
        const entries = await this.historyController.service.searchHistory(query);

        // Deduplicate by URL, keep most recent (entries already sorted newest-first)
        const seen = new Set();
        this.suggestions = [];
        for (const entry of entries) {
            const url = entry.request?.rawUrl || entry.request?.url;
            if (url && !seen.has(url)) {
                seen.add(url);
                this.suggestions.push(entry);
                if (this.suggestions.length >= 8) { break; }
            }
        }

        this._render();
    }

    _render() {
        this.dropdown.innerHTML = '';
        this.activeIndex = -1;

        if (this.suggestions.length === 0) {
            this._hide();
            return;
        }

        this.suggestions.forEach((entry, index) => {
            const li = document.createElement('li');
            li.className = 'url-autocomplete-item';
            li.setAttribute('role', 'option');

            const method = entry.request.method || 'GET';
            const url = entry.request.rawUrl || entry.request.url || '';
            const time = this.historyController.service.formatTimestamp(entry.timestamp);

            li.innerHTML = `
                <span class="url-autocomplete-method"></span>
                <span class="url-autocomplete-url" title="${url}">${url}</span>
                <span class="url-autocomplete-time">${time}</span>
            `;
            // Set method text and color using same pattern as HistoryRenderer
            const methodEl = li.querySelector('.url-autocomplete-method');
            methodEl.textContent = method;
            methodEl.style.color = this.historyController.service.getMethodColor(method);

            // mousedown instead of click so it fires before the input blur
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._select(entry);
            });

            li.addEventListener('mouseover', () => this._setActive(index));

            this.dropdown.appendChild(li);
        });

        this.dropdown.classList.add('visible');
    }

    _setActive(index) {
        const items = this.dropdown.querySelectorAll('.url-autocomplete-item');
        items.forEach((el, i) => el.classList.toggle('active', i === index));
        this.activeIndex = index;
    }

    _select(entry) {
        this._hide();
        this.historyController.handleHistorySelect(entry);
    }

    _hide() {
        this.dropdown.classList.remove('visible');
        this.activeIndex = -1;
    }

    _isVisible() {
        return this.dropdown.classList.contains('visible');
    }
}
