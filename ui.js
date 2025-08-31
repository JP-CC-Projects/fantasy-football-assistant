// Fantasy Draft Assistant - UI Logic
class FantasyDraftApp {
    constructor() {
        this.players = [];
        this.settings = this.loadSettings();
        this.playersState = this.loadPlayersState();
        this.rosters = this.loadRosters();
        this.progress = this.loadProgress();
        this.ui = this.loadUI();
        
        this.init();
    }

    init() {
        this.loadPlayersData();
        this.setupEventListeners();
        this.render();
        this.updateDraftInfo();
    }

    // LocalStorage Management
    loadSettings() {
        const defaultSettings = {
            nTeams: 8,
            snake: true,
            myTeamId: "T1",
            teamNames: ["Me", "Team 2", "Team 3", "Team 4", "Team 5", "Team 6", "Team 7", "Team 8"],
            pickOrder: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
        };
        
        const saved = localStorage.getItem('fdraft/settings');
        return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    }

    loadPlayersState() {
        const saved = localStorage.getItem('fdraft/players');
        return saved ? JSON.parse(saved) : { players: [] };
    }

    loadRosters() {
        const defaultRosters = {};
        for (let i = 1; i <= this.settings.nTeams; i++) {
            const teamId = `T${i}`;
            defaultRosters[teamId] = {
                QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0, FLEX: 0, bench: 0
            };
        }
        
        const saved = localStorage.getItem('fdraft/rosters');
        return saved ? { ...defaultRosters, ...JSON.parse(saved) } : defaultRosters;
    }

    loadProgress() {
        const defaultProgress = {
            round: 1,
            pickInRound: 1,
            currentTeamId: "T1",
            history: []
        };
        
        const saved = localStorage.getItem('fdraft/progress');
        return saved ? { ...defaultProgress, ...JSON.parse(saved) } : defaultProgress;
    }

    loadUI() {
        const defaultUI = {
            search: "",
            roleTopLimit: 10
        };
        
        const saved = localStorage.getItem('fdraft/ui');
        return saved ? { ...defaultUI, ...JSON.parse(saved) } : defaultUI;
    }

    saveSettings() {
        localStorage.setItem('fdraft/settings', JSON.stringify(this.settings));
    }

    savePlayersState() {
        localStorage.setItem('fdraft/players', JSON.stringify(this.playersState));
    }

    saveRosters() {
        localStorage.setItem('fdraft/rosters', JSON.stringify(this.rosters));
    }

    saveProgress() {
        localStorage.setItem('fdraft/progress', JSON.stringify(this.progress));
    }

    saveUI() {
        localStorage.setItem('fdraft/ui', JSON.stringify(this.ui));
    }

    // Data Loading
    loadPlayersData() {
        if (typeof window.PlayerData !== 'undefined') {
            this.players = window.PlayerData;
            
            // Initialize players state if empty
            if (this.playersState.players.length === 0) {
                this.playersState.players = this.players.map(player => ({
                    ...player,
                    takenBy: null
                }));
                this.savePlayersState();
            }
        } else {
            console.error('PlayerData not available');
        }
    }

    // Event Listeners
    setupEventListeners() {
        // Global search
        const searchInput = document.getElementById('global-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.ui.search = e.target.value;
                this.saveUI();
                // Only re-render player columns on search to prevent gutter bounce
                this.renderPositionColumns();
            });
        }
        

        // Draft controls
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undoLastPick());
        }

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetDraft());
        }

        const simulateBtn = document.getElementById('simulate-pick-btn');
        if (simulateBtn) {
            simulateBtn.addEventListener('click', () => this.simulateOtherTeamPick());
        }

        // Settings modal
        const settingsBtn = document.getElementById('settings-btn');
        const modal = document.getElementById('settings-modal');
        const closeBtn = document.querySelector('.close');
        const saveSettingsBtn = document.getElementById('save-settings');

        if (settingsBtn && modal) {
            settingsBtn.addEventListener('click', () => this.openSettingsModal());
        }

        if (closeBtn && modal) {
            closeBtn.addEventListener('click', () => this.closeSettingsModal());
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeSettingsModal();
                }
            });
        }

        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => this.saveSettingsFromModal());
        }

        // League size change handler
        const leagueSizeSelect = document.getElementById('league-size');
        if (leagueSizeSelect) {
            leagueSizeSelect.addEventListener('change', () => this.updateDraftPositionOptions());
        }
    }

    // Rendering
    render() {
        this.renderPositionColumns();
        this.renderDraftBoard();
        this.renderMyTeam();
        this.updateDraftInfo();
        this.updateUndoButton();
    }

    renderPositionColumns() {
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
        
        // Get algorithm suggestions for current state
        const topPicks = this.getAlgorithmTopPicks();
        console.log('Top picks in renderPositionColumns:', topPicks);
        
        positions.forEach(pos => {
            const listElement = document.getElementById(`${pos.toLowerCase()}-list`);
            if (!listElement) return;

            const availablePlayers = this.getAvailablePlayersByPosition(pos);
            const filteredPlayers = this.filterPlayersBySearch(availablePlayers);
            const topPlayers = filteredPlayers.slice(0, this.ui.roleTopLimit);

            console.log(`[${pos}] avail=${availablePlayers.length}, filtered=${filteredPlayers.length}, top=${topPlayers.length}, search="${this.ui.search}"`);

            if (topPlayers.length === 0) {
                listElement.innerHTML = `<div class="empty-list">No ${pos} players match current filters</div>`;
                return;
            }

            listElement.innerHTML = topPlayers.map(player => {
                // Find if this player is in the top 5 picks
                const pickRank = topPicks.findIndex(p => p.id === player.id) + 1;
                console.log(`Player ${player.name} (${player.id}) - pickRank: ${pickRank}`);
                
                return this.createPlayerCard(player, pickRank > 0 ? pickRank : null);
            }).join('');

            // Add click handlers
            listElement.querySelectorAll('.player-card').forEach((card, index) => {
                card.addEventListener('click', () => {
                    this.draftPlayer(topPlayers[index]);
                });
            });
        });
    }

    renderDraftBoard() {
        const draftGrid = document.getElementById('draft-grid');
        if (!draftGrid) return;

        const totalPicks = this.settings.nTeams * 16; // Assuming 16 rounds
        const picks = [];

        for (let i = 1; i <= totalPicks; i++) {
            const round = Math.ceil(i / this.settings.nTeams);
            const pickInRound = ((i - 1) % this.settings.nTeams) + 1;
            const teamId = this.getTeamForPick(round, pickInRound);
            const player = this.getPlayerAtPick(i);

            picks.push(this.createDraftPick(i, round, pickInRound, teamId, player));
        }

        draftGrid.innerHTML = picks.join('');
    }

    renderMyTeam() {
        const myRoster = document.getElementById('my-roster');
        if (!myRoster) return;

        const myTeamId = this.settings.myTeamId;
        const myPlayers = this.playersState.players.filter(p => p.takenBy === myTeamId);
        
        const positions = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];
        const rosterHTML = positions.map(pos => {
            const posPlayers = myPlayers.filter(p => p.position === pos);
            return this.createRosterPosition(pos, posPlayers);
        }).join('');

        myRoster.innerHTML = rosterHTML;
    }

    // Helper Methods
    getAvailablePlayersByPosition(position) {
        return this.playersState.players
            .filter(p => p.position === position && p.takenBy === null)
            .sort((a, b) => b.EV - a.EV);
    }

    filterPlayersBySearch(players) {
        if (!this.ui.search) return players;
        
        const searchLower = this.ui.search.toLowerCase();
        return players.filter(player => 
            player.name.toLowerCase().includes(searchLower) ||
            player.team.toLowerCase().includes(searchLower) ||
            player.position.toLowerCase().includes(searchLower)
        );
    }

    getTeamForPick(round, pickInRound) {
        if (this.settings.snake && round % 2 === 0) {
            // Reverse order for even rounds
            return this.settings.pickOrder[this.settings.nTeams - pickInRound];
        } else {
            return this.settings.pickOrder[pickInRound - 1];
        }
    }

    getPlayerAtPick(pickNumber) {
        const historyEntry = this.progress.history[pickNumber - 1];
        if (!historyEntry) return null;
        
        const [playerId, teamId] = historyEntry.split('@');
        return this.playersState.players.find(p => p.id === playerId);
    }

    // Player Card Creation
    createPlayerCard(player, pickRank = null) {
        const isMyTeam = player.takenBy === this.settings.myTeamId;
        const isDrafted = player.takenBy !== null;
        const isCurrentTeam = this.progress.currentTeamId === this.settings.myTeamId;
        
        let classes = 'player-card';
        if (isDrafted) classes += ' drafted';
        if (isMyTeam) classes += ' my-team';
        if (isCurrentTeam && !isDrafted) classes += ' clickable';
        
        // Add top pick classes
        if (pickRank === 1) {
            classes += ' top-pick';
            console.log(`Adding top-pick class to ${player.name}`);
        }
        else if (pickRank === 2) classes += ' second-pick';
        else if (pickRank === 3) classes += ' third-pick';
        else if (pickRank === 4) classes += ' fourth-pick';
        else if (pickRank === 5) classes += ' fifth-pick';
        
        // Create pick label
        let pickLabel = '';
        if (pickRank === 1) pickLabel = '<div class="pick-label">TOP PICK</div>';
        else if (pickRank === 2) pickLabel = '<div class="pick-label">2ND PICK</div>';
        else if (pickRank === 3) pickLabel = '<div class="pick-label">3RD PICK</div>';
        else if (pickRank === 4) pickLabel = '<div class="pick-label">4TH PICK</div>';
        else if (pickRank === 5) pickLabel = '<div class="pick-label">5TH PICK</div>';
        
        console.log(`Creating card for ${player.name} with classes: "${classes}", pickRank: ${pickRank}`);
        
        return `
            <div class="${classes}">
                ${pickLabel}
                <div class="player-name">${player.name}</div>
                <div class="player-details">
                    <span>${player.team}</span>
                    <span class="player-ev">${player.EV}</span>
                </div>
            </div>
        `;
    }

    createDraftPick(pickNumber, round, pickInRound, teamId, player) {
        const isCurrentPick = pickNumber === this.getCurrentPickNumber();
        const isMyTeam = teamId === this.settings.myTeamId;
        const isFilled = player !== null;
        
        let classes = 'draft-pick';
        if (isFilled) classes += ' filled';
        if (isMyTeam) classes += ' my-team';
        if (isCurrentPick) classes += ' current';

        const pickNumberText = `Round ${round}, Pick ${pickInRound}`;
        const teamName = this.getDisplayTeamName(teamId);
        
        if (isFilled) {
            return `
                <div class="${classes}">
                    <div class="pick-number">${pickNumberText}</div>
                    <div class="pick-player">${player.name}</div>
                    <div class="pick-team">${teamName}</div>
                </div>
            `;
        } else {
            return `
                <div class="${classes}">
                    <div class="pick-number">${pickNumberText}</div>
                    <div class="pick-player">${teamName}</div>
                    <div class="pick-team">On the clock</div>
                </div>
            `;
        }
    }

    createRosterPosition(position, players) {
        return `
            <div class="roster-position">
                <h4>${position} (${players.length})</h4>
                <div class="roster-players">
                    ${players.map(player => `
                        <div class="roster-player">
                            <span>${player.name}</span>
                            <span class="player-ev">${player.EV}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Draft Logic
    draftPlayer(player) {
        if (player.takenBy !== null) return;
        
        const currentTeamId = this.progress.currentTeamId;
        
        // Update player state
        player.takenBy = currentTeamId;
        
        // Update roster
        this.rosters[currentTeamId][player.position]++;
        
        // Add to history
        this.progress.history.push(`${player.id}@${currentTeamId}`);
        
        // Move to next pick
        this.moveToNextPick();
        
        // Save state
        this.savePlayersState();
        this.saveRosters();
        this.saveProgress();
        
        // Re-render
        this.render();
    }

    moveToNextPick() {
        this.progress.pickInRound++;
        
        if (this.progress.pickInRound > this.settings.nTeams) {
            this.progress.round++;
            this.progress.pickInRound = 1;
        }
        
        // Update current team
        const pickNumber = this.getCurrentPickNumber();
        const round = this.progress.round;
        const pickInRound = this.progress.pickInRound;
        this.progress.currentTeamId = this.getTeamForPick(round, pickInRound);
    }

    getCurrentPickNumber() {
        return (this.progress.round - 1) * this.settings.nTeams + this.progress.pickInRound;
    }

    undoLastPick() {
        if (this.progress.history.length === 0) return;
        
        const lastPick = this.progress.history.pop();
        const [playerId, teamId] = lastPick.split('@');
        
        // Find and update player
        const player = this.playersState.players.find(p => p.id === playerId);
        if (player) {
            player.takenBy = null;
            
            // Update roster
            this.rosters[teamId][player.position]--;
            
            // Move back to previous pick
            this.moveToPreviousPick();
            
            // Save state
            this.savePlayersState();
            this.saveRosters();
            this.saveProgress();
            
            // Re-render
            this.render();
        }
    }

    moveToPreviousPick() {
        this.progress.pickInRound--;
        
        if (this.progress.pickInRound < 1) {
            this.progress.round--;
            this.progress.pickInRound = this.settings.nTeams;
        }
        
        // Update current team
        const round = this.progress.round;
        const pickInRound = this.progress.pickInRound;
        this.progress.currentTeamId = this.getTeamForPick(round, pickInRound);
    }

    resetDraft() {
        if (confirm('Are you sure you want to reset the entire draft? This cannot be undone.')) {
            // Reset all state
            this.playersState.players = this.players.map(player => ({
                ...player,
                takenBy: null
            }));
            
            this.rosters = {};
            for (let i = 1; i <= this.settings.nTeams; i++) {
                const teamId = `T${i}`;
                this.rosters[teamId] = {
                    QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0, FLEX: 0, bench: 0
                };
            }
            
            this.progress = {
                round: 1,
                pickInRound: 1,
                currentTeamId: "T1",
                history: []
            };
            
            this.ui.search = "";
            
            // Save all state
            this.savePlayersState();
            this.saveRosters();
            this.saveProgress();
            this.saveUI();
            
            // Re-render
            this.render();
        }
    }

    simulateOtherTeamPick() {
        if (this.progress.currentTeamId === this.settings.myTeamId) {
            alert("It's your turn! Please make your pick.");
            return;
        }

        // Get available players and pick the highest EV player
        const availablePlayers = this.playersState.players
            .filter(p => p.takenBy === null)
            .sort((a, b) => b.EV - a.EV);

        if (availablePlayers.length === 0) {
            alert("No players available to draft!");
            return;
        }

        // Pick the highest EV player
        const selectedPlayer = availablePlayers[0];
        this.draftPlayer(selectedPlayer);
    }

    openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        const leagueSizeSelect = document.getElementById('league-size');
        const draftPositionSelect = document.getElementById('draft-position');
        const snakeDraftCheckbox = document.getElementById('snake-draft');

        if (modal && leagueSizeSelect && draftPositionSelect && snakeDraftCheckbox) {
            // Set current values
            leagueSizeSelect.value = this.settings.nTeams;
            draftPositionSelect.value = this.settings.pickOrder.indexOf(this.settings.myTeamId) + 1;
            snakeDraftCheckbox.checked = this.settings.snake;

            // Update draft position options based on league size
            this.updateDraftPositionOptions();

            modal.style.display = 'block';
        }
    }

    closeSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    updateDraftPositionOptions() {
        const leagueSizeSelect = document.getElementById('league-size');
        const draftPositionSelect = document.getElementById('draft-position');
        
        if (leagueSizeSelect && draftPositionSelect) {
            const currentSize = parseInt(leagueSizeSelect.value);
            const currentPosition = parseInt(draftPositionSelect.value);
            
            // Clear existing options
            draftPositionSelect.innerHTML = '';
            
            // Add new options
            for (let i = 1; i <= currentSize; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `${i}${this.getOrdinalSuffix(i)} Pick`;
                draftPositionSelect.appendChild(option);
            }
            
            // Set to current position if valid, otherwise 1
            draftPositionSelect.value = currentPosition <= currentSize ? currentPosition : 1;
        }
    }

    getOrdinalSuffix(num) {
        if (num >= 11 && num <= 13) return 'th';
        switch (num % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    saveSettingsFromModal() {
        const leagueSizeSelect = document.getElementById('league-size');
        const draftPositionSelect = document.getElementById('draft-position');
        const snakeDraftCheckbox = document.getElementById('snake-draft');

        if (leagueSizeSelect && draftPositionSelect && snakeDraftCheckbox) {
            const newLeagueSize = parseInt(leagueSizeSelect.value);
            const newDraftPosition = parseInt(draftPositionSelect.value);
            const newSnakeDraft = snakeDraftCheckbox.checked;

            // Check if we need to reset the draft due to major changes
            if (newLeagueSize !== this.settings.nTeams || newDraftPosition !== (this.settings.pickOrder.indexOf(this.settings.myTeamId) + 1)) {
                if (confirm('Changing league size or draft position will reset the current draft. Continue?')) {
                    this.resetDraft();
                } else {
                    return;
                }
            }

            // Update settings
            this.settings.nTeams = newLeagueSize;
            this.settings.snake = newSnakeDraft;

            // Update team names array
            this.settings.teamNames = [];
            for (let i = 1; i <= newLeagueSize; i++) {
                if (i === newDraftPosition) {
                    this.settings.teamNames.push("Me");
                } else {
                    this.settings.teamNames.push(`Team ${i}`);
                }
            }

            // Update pick order
            this.settings.pickOrder = [];
            for (let i = 1; i <= newLeagueSize; i++) {
                this.settings.pickOrder.push(`T${i}`);
            }

            // Update my team ID based on draft position
            this.settings.myTeamId = `T${newDraftPosition}`;

            // Update rosters for new team count
            this.rosters = {};
            for (let i = 1; i <= newLeagueSize; i++) {
                const teamId = `T${i}`;
                this.rosters[teamId] = {
                    QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0, FLEX: 0, bench: 0
                };
            }

            // Save all settings
            this.saveSettings();
            this.saveRosters();
            this.saveProgress();

            // Close modal and re-render
            this.closeSettingsModal();
            this.render();
        }
    }

    // UI Updates
    updateDraftInfo() {
        const teamNameElement = document.getElementById('team-name');
        const roundElement = document.getElementById('round-number');
        const pickElement = document.getElementById('pick-in-round');
        const turnIndicator = document.getElementById('turn-indicator');
        const turnText = document.getElementById('turn-text');
        
        if (teamNameElement) {
            teamNameElement.textContent = this.getDisplayTeamName(this.progress.currentTeamId);
        }
        
        if (roundElement) {
            roundElement.textContent = this.progress.round;
        }
        
        if (pickElement) {
            pickElement.textContent = this.progress.pickInRound;
        }
        
        // Update turn indicator
        if (turnIndicator && turnText) {
            const isMyTurn = this.progress.currentTeamId === this.settings.myTeamId;
            if (isMyTurn) {
                turnIndicator.className = 'turn-indicator my-turn';
                turnText.textContent = 'YOUR TURN';
            } else {
                turnIndicator.className = 'turn-indicator other-turn';
                turnText.textContent = `Waiting for ${this.getDisplayTeamName(this.progress.currentTeamId)}`;
            }
        }
    }

    getDisplayTeamName(teamId) {
        const index = parseInt(teamId.slice(1));
        const idx0 = isNaN(index) ? -1 : index - 1;
        const custom = Array.isArray(this.settings.teamNames) && idx0 >= 0 ? this.settings.teamNames[idx0] : null;
        if (custom && String(custom).trim().length > 0) return String(custom).trim();
        if (teamId === this.settings.myTeamId) return 'Me';
        return `Team ${index}`;
    }

    updateUndoButton() {
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.disabled = this.progress.history.length === 0;
        }
    }

    // Helper function to get sigma values for positions
    getSigmaForPosition(position) {
        const sigmaByPos = { QB: 8, RB: 6, WR: 7, TE: 8, DST: 10, K: 12 };
        return sigmaByPos[position] || 8.0;
    }

    // Algorithm Integration
    getAlgorithmTopPicks() {
        if (typeof window.DraftAlgo === 'undefined') {
            console.log('DraftAlgo not available');
            return [];
        }

        try {
            // Create roster state for the algorithm
            const myRoster = this.rosters[this.settings.myTeamId];
            const rosterState = window.DraftAlgo.makeEmptyRosterState();
            
            // Convert our roster format to algorithm format
            rosterState.have = { ...myRoster };
            rosterState.startersFilled = {
                QB: Math.min(myRoster.QB, 1),
                RB: Math.min(myRoster.RB, 2),
                WR: Math.min(myRoster.WR, 2),
                TE: Math.min(myRoster.TE, 1),
                DST: Math.min(myRoster.DST, 1),
                K: Math.min(myRoster.K, 1)
            };
            rosterState.haveFlex = Math.min(myRoster.FLEX, 1);
            rosterState.benchTotal = myRoster.bench;

            // Get available players
            const availablePlayers = this.playersState.players
                .filter(p => p.takenBy === null)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    pos: p.position,
                    EV: p.EV,
                    ADP: p.ADP || null, // Use actual ADP data if available
                    risk: 0,
                    bye: null,
                    team: p.team || null, // Include team for synergy scoring
                    tier: null, // Could be added later if you have tier data
                    adpStd: null // Could be calculated from ADP variance if needed
                }));

            console.log('Available players:', availablePlayers.length);
            console.log('Roster state:', rosterState);
            console.log('League size:', this.settings.nTeams);
            console.log('Round:', this.progress.round);
            console.log('Pick position:', this.settings.pickOrder.indexOf(this.settings.myTeamId) + 1);
            
            // Log ADP data availability
            const playersWithADP = availablePlayers.filter(p => p.ADP !== null).length;
            console.log(`Players with ADP data: ${playersWithADP}/${availablePlayers.length}`);
            if (playersWithADP > 0) {
                const sampleADP = availablePlayers.find(p => p.ADP !== null);
                console.log('Sample player with ADP:', sampleADP.name, 'ADP:', sampleADP.ADP);
            }

            // Call the algorithm with v2 options
            const suggestion = window.DraftAlgo.suggestPick(
                availablePlayers,
                rosterState,
                this.settings.nTeams,
                this.progress.round,
                this.settings.pickOrder.indexOf(this.settings.myTeamId) + 1,
                {
                    // Use v2 advanced options optimized for ADP data
                    kDstGatingRound: 10,
                    kDstGateAtNextPick: true,
                    topK: 30, // Dynamic candidate horizon
                    sigmaByPos: { QB: 8, RB: 6, WR: 7, TE: 8, DST: 10, K: 12 }, // Tighter sigmas for better ADP precision
                    scoring: { ppr: 1.0, tePremium: 1.0 },
                    seatIndex: this.settings.pickOrder.indexOf(this.settings.myTeamId),
                    runBoost: 0.35,
                    tierScarcityThreshold: 2,
                    // Enhanced options for ADP utilization
                    riskLambda: 0.1, // Small risk penalty
                    byePolicy: { maxSameByeStarters: { RB: 2, WR: 2, TE: 1 }, basePenalty: 0.05, scaleByRound: true, totalRounds: 16 }
                }
            );

            console.log('Algorithm suggestion:', suggestion);

            if (suggestion && suggestion.top && suggestion.top.length > 0) {
                console.log('Raw algorithm top picks:', suggestion.top);
                console.log('First algorithm player structure:', JSON.stringify(suggestion.top[0], null, 2));
                
                // Log how ADP is being used in recommendations
                console.log('Top picks with ADP analysis:');
                suggestion.top.forEach((pick, index) => {
                    const originalPlayer = this.playersState.players.find(p => 
                        p.name === pick.name && p.position === pick.pos
                    );
                    if (originalPlayer && originalPlayer.ADP) {
                        const currentPick = this.progress.round * this.settings.nTeams;
                        const picksUntilNext = this.settings.nTeams - (this.settings.pickOrder.indexOf(this.settings.myTeamId) + 1);
                        const nextPick = currentPick + picksUntilNext + 1;
                        
                        // Calculate survival probability manually to show ADP usage
                        const sigma = this.getSigmaForPosition(pick.pos);
                        const z = (nextPick - originalPlayer.ADP) / sigma;
                        const pGone = 1 / (1 + Math.exp(-z));
                        const survivalProb = Math.max(0, Math.min(1, 1 - pGone));
                        
                        console.log(`${index + 1}. ${pick.name} (${pick.pos}) - EV: ${pick.EV}, ADP: ${originalPlayer.ADP}, Next Pick: ${nextPick}, Survival: ${(survivalProb * 100).toFixed(1)}%, Score: ${pick.score}`);
                    }
                });
                // Map the algorithm results back to our player objects
                const topPicks = suggestion.top.map(algPlayer => {
                    // Algorithm returns players without IDs, so match by name and position
                    const originalPlayer = this.playersState.players.find(p => 
                        p.name === algPlayer.name && p.position === algPlayer.pos
                    );
                    console.log(`Looking for ${algPlayer.name} (${algPlayer.pos}) by name/pos, found:`, originalPlayer);
                    return originalPlayer || algPlayer;
                });
                console.log('Mapped top picks:', topPicks);
                return topPicks;
            } else {
                console.log('No suggestion or top picks from algorithm');
            }
        } catch (error) {
            console.error('Error getting algorithm top picks:', error);
        }

        // Fallback: if algorithm fails, just return the highest EV available player
        if (this.playersState.players.length > 0) {
            const availablePlayers = this.playersState.players.filter(p => p.takenBy === null);
            if (availablePlayers.length > 0) {
                const topPlayer = availablePlayers.sort((a, b) => b.EV - a.EV)[0];
                console.log('Fallback: using highest EV player as top pick:', topPlayer.name);
                return [topPlayer];
            }
        }

        return [];
    }


}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.fantasyDraftApp = new FantasyDraftApp();
});
