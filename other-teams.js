(function () {
    function initWhenReady() {
        if (!window.fantasyDraftApp) {
            setTimeout(initWhenReady, 100);
            return;
        }

        const app = window.fantasyDraftApp;
        const panel = new OtherTeamsPanel(app);

        const originalRender = app.render.bind(app);
        app.render = function () {
            originalRender();
            panel.render();
        };

        panel.render();
    }

    class OtherTeamsPanel {
        constructor(app) {
            this.app = app;
            this.state = {
                collapsed: false,
                selectedTeamId: null
            };
        }

        getEls() {
            const gutter = document.querySelector('.right-gutter');
            if (!gutter) return {};
            return {
                gutter,
                header: gutter.querySelector('h3'),
                container: gutter.querySelector('#other-teams-grid')
            };
        }

        getTeamName(teamId) {
            const idx = Math.max(0, (parseInt(teamId?.slice(1), 10) || 1) - 1);
            const fromSettings = Array.isArray(this.app.settings.teamNames) ? this.app.settings.teamNames[idx] : null;
            if (fromSettings && String(fromSettings).trim().length > 0) return String(fromSettings).trim();
            // Fallbacks
            if (typeof this.app.getDisplayTeamName === 'function') {
                return this.app.getDisplayTeamName(teamId);
            }
            return idx + 1 === 1 ? 'Me' : `Team ${idx + 1}`;
        }

        saveTeamName(teamId, newName) {
            const name = String(newName || '').trim();
            if (!name) return;
            const idx = Math.max(0, (parseInt(teamId?.slice(1), 10) || 1) - 1);
            if (!Array.isArray(this.app.settings.teamNames)) this.app.settings.teamNames = [];
            this.app.settings.teamNames[idx] = name;
            if (typeof this.app.saveSettings === 'function') {
                this.app.saveSettings();
            } else {
                try {
                    localStorage.setItem('fdraft/settings', JSON.stringify(this.app.settings));
                } catch (_) {}
            }
            // Re-render main header text if needed
            if (typeof this.app.updateDraftInfo === 'function') {
                this.app.updateDraftInfo();
            }
            this.render();
        }

        render() {
            const els = this.getEls();
            if (!els.container || !els.header) return;

            if (this.state.collapsed) {
                this.renderCollapsed(els);
            } else {
                const teamId = this.state.selectedTeamId || this.app.progress.currentTeamId;
                this.renderExpanded(teamId, els);
            }
        }

        renderExpanded(teamId, els) {
            const name = this.getTeamName(teamId);
            els.header.innerHTML = `${name} <button class="edit-team" title="Edit name" aria-label="Edit team name">✎</button>`;
            els.header.style.cursor = 'pointer';
            els.header.onclick = () => {
                this.state.collapsed = true;
                this.render();
            };
            const btn = els.header.querySelector('.edit-team');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const current = this.getTeamName(teamId);
                    const next = prompt('Edit team name:', current);
                    if (next !== null) this.saveTeamName(teamId, next);
                });
            }

            const teamPlayers = this.app.playersState.players.filter(p => p.takenBy === teamId);
            const positions = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

            let rosterHTML = '';
            if (typeof this.app.createRosterPosition === 'function') {
                rosterHTML = positions.map(pos => {
                    const posPlayers = teamPlayers.filter(p => p.position === pos);
                    return this.app.createRosterPosition(pos, posPlayers);
                }).join('');
            } else {
                rosterHTML = positions.map(pos => {
                    const posPlayers = teamPlayers.filter(p => p.position === pos);
                    return `
                        <div class="roster-position">
                            <h4>${pos} (${posPlayers.length})</h4>
                            <div class="roster-players">
                                ${posPlayers.map(player => `
                                    <div class="roster-player">
                                        <span>${player.name}</span>
                                        <span class="player-ev">${player.EV}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }).join('');
            }

            els.container.innerHTML = rosterHTML || '<div class="empty-list">No picks yet</div>';
        }

        renderCollapsed(els) {
            els.header.textContent = 'All Teams';
            els.header.style.cursor = 'pointer';
            els.header.onclick = () => {
                this.state.selectedTeamId = this.app.progress.currentTeamId;
                this.state.collapsed = false;
                this.render();
            };

            const teams = this.app.settings.pickOrder.slice();
            const items = teams.map(teamId => {
                const name = this.getTeamName(teamId);
                const isCurrent = teamId === this.app.progress.currentTeamId;
                const currentClass = isCurrent ? ' current' : '';
                return `
                    <div class="roster-player team-item${currentClass}" data-team="${teamId}">
                        <span>${name}</span>
                        <button class="edit-team" title="Edit name" aria-label="Edit team name" data-edit="${teamId}">✎</button>
                    </div>`;
            }).join('');

            els.container.innerHTML = `
                <div class="roster-position">
                    <div class="roster-players">${items}</div>
                </div>
            `;

            els.container.querySelectorAll('.team-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const teamId = item.getAttribute('data-team');
                    this.state.selectedTeamId = teamId;
                    this.state.collapsed = false;
                    this.render();
                });
            });

            els.container.querySelectorAll('.edit-team').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const teamId = btn.getAttribute('data-edit');
                    const current = this.getTeamName(teamId);
                    const next = prompt('Edit team name:', current);
                    if (next !== null) this.saveTeamName(teamId, next);
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenReady);
    } else {
        initWhenReady();
    }
})();
