// Preserve the current app build, then apply a focused date-validation fix.
// This wrapper pins the previous known-good script so only the edit-date bug changes here.
const APP_BUILD_URL = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@588c08dbe8cbc72bad46d979d8d2501e008c0bc8/script.js';

document.write(`<script src="${APP_BUILD_URL}"><\/script>`);

document.write(`<script>
(function () {
    const startInput = document.getElementById('input-date-start');
    const endInput = document.getElementById('input-date-end');
    const trackerForm = document.getElementById('tracker-form');

    if (!startInput || !endInput) return;

    function syncEndDateMinimum({ repairValue = false } = {}) {
        const start = startInput.value || '';

        if (start) {
            endInput.min = start;
        } else {
            endInput.removeAttribute('min');
        }

        endInput.setCustomValidity('');

        if (repairValue && start && endInput.value && endInput.value < start) {
            endInput.value = start;
        }
    }

    // Keep the native constraint aligned whenever the user changes the start date.
    startInput.addEventListener('input', () => syncEndDateMinimum());
    startInput.addEventListener('change', () => syncEndDateMinimum({ repairValue: true }));

    // Core bug fix: editLocation fills dates programmatically, which does not fire
    // the original change handler. That left an old min date (for example 2026-08-12)
    // attached to the end-date field while editing an older trip.
    const originalEditLocation = typeof editLocation === 'function' ? editLocation : null;
    if (originalEditLocation) {
        editLocation = function fixedEditLocation(id) {
            originalEditLocation(id);
            syncEndDateMinimum();
        };
    }

    // A form reset does not reliably remove a min attribute assigned by JavaScript,
    // so clear it after successful saves / cancelled edits / fresh-entry resets.
    trackerForm?.addEventListener('reset', () => {
        requestAnimationFrame(() => {
            endInput.removeAttribute('min');
            endInput.setCustomValidity('');
        });
    });

    const originalCancelEdit = typeof cancelEdit === 'function' ? cancelEdit : null;
    if (originalCancelEdit) {
        cancelEdit = function fixedCancelEdit() {
            originalCancelEdit();
            endInput.removeAttribute('min');
            endInput.setCustomValidity('');
        };
    }

    // If the page is restored by the browser with values already present, normalize once.
    syncEndDateMinimum();
})();
<\/script>`);
