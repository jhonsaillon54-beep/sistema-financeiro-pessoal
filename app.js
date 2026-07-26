/* ==========================================================================
   Financly - Application Core Controller with Auth, Recovery, DB & Time Travel Dashboard
   ========================================================================== */

// --- Global Application State ---
let state = {
    username: null,
    referenceMonth: null, // "YYYY-MM"
    transactions: [],
    categories: [],
    budgets: {}, // { categoryName: amount }
    theme: 'dark',
    sort: {
        field: 'date',
        direction: 'desc'
    }
};

// --- Chart Instances ---
let cashFlowChartInstance = null;
let categoryChartInstance = null;

// --- Default Categories Configuration ---
const DEFAULT_CATEGORIES = [
    { name: 'Alimentação', color: '#f43f5e', icon: 'fa-utensils' },
    { name: 'Transporte', color: '#3b82f6', icon: 'fa-car' },
    { name: 'Moradia', color: '#f59e0b', icon: 'fa-home' },
    { name: 'Lazer', color: '#10b981', icon: 'fa-bolt' },
    { name: 'Saúde', color: '#ec4899', icon: 'fa-heartbeat' },
    { name: 'Educação', color: '#8b5cf6', icon: 'fa-graduation-cap' },
    { name: 'Salário', color: '#14b8a6', icon: 'fa-money-bill-wave' },
    { name: 'Outros', color: '#6b7280', icon: 'fa-ellipsis-h' }
];

// --- Default Seeding Transactions Template (used to generate 6 months of history) ---
const DEMO_TRANSACTIONS = [
    { description: 'Salário Mensal', amount: 5500.00, type: 'income', category: 'Salário', dateOffset: -5, day: '05' },
    { description: 'Aluguel do Apartamento', amount: 1500.00, type: 'expense', category: 'Moradia', dateOffset: -10, day: '10' },
    { description: 'Supermercado Mensal', amount: 650.00, type: 'expense', category: 'Alimentação', dateOffset: -12, day: '12' },
    { description: 'Combustível Carro', amount: 220.00, type: 'expense', category: 'Transporte', dateOffset: -14, day: '14' },
    { description: 'Jantar Pizzaria', amount: 120.00, type: 'expense', category: 'Lazer', dateOffset: -15, day: '15' },
    { description: 'Consulta Odontológica', amount: 180.00, type: 'expense', category: 'Saúde', dateOffset: -18, day: '18' },
    { description: 'Curso de Especialização', amount: 350.00, type: 'expense', category: 'Educação', dateOffset: -20, day: '20' },
    { description: 'Venda de Item Antigo', amount: 250.00, type: 'income', category: 'Outros', dateOffset: -21, day: '21' }
];

const DEMO_BUDGETS = {
    'Alimentação': 800.00,
    'Moradia': 1600.00,
    'Lazer': 400.00,
    'Transporte': 300.00
};

// --- Database Configuration (IndexedDB & Supabase fallback) ---
const DB_NAME = 'FinanclyDB';
const DB_VERSION = 1;
let db = null;
let supabase = null;

// Initialize Supabase Connection if available
async function initSupabase() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            if (config.url && config.key && window.supabase) {
                supabase = window.supabase.createClient(config.url, config.key);
                console.log("Supabase Client initialized successfully.");
                updateDBBadge(true);
                return true;
            }
        }
    } catch (e) {
        console.warn("Could not retrieve Supabase config. Using IndexedDB local store.", e);
    }
    updateDBBadge(false);
    return false;
}

function updateDBBadge(isCloud) {
    const badge = document.getElementById('dbStatusBadge');
    if (badge) {
        if (isCloud) {
            badge.className = 'db-status-badge cloud';
            badge.innerHTML = '<i class="fa-solid fa-cloud"></i> <span>Nuvem</span>';
            badge.title = 'Armazenamento em Nuvem Ativo (Supabase)';
        } else {
            badge.className = 'db-status-badge local';
            badge.innerHTML = '<i class="fa-solid fa-database"></i> <span>Local</span>';
            badge.title = 'Armazenamento Local Ativo (IndexedDB)';
        }
    }
}

// Initialize Database Connection
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (e) => {
            console.error("Database failed to open: ", e.target.error);
            reject(e.target.error);
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const dbInstance = e.target.result;

            // Users Store
            if (!dbInstance.objectStoreNames.contains('users')) {
                dbInstance.createObjectStore('users', { keyPath: 'username' });
            }

            // Transactions Store
            if (!dbInstance.objectStoreNames.contains('transactions')) {
                const store = dbInstance.createObjectStore('transactions', { keyPath: 'id' });
                store.createIndex('username', 'username', { unique: false });
            }

            // Categories Store
            if (!dbInstance.objectStoreNames.contains('categories')) {
                const store = dbInstance.createObjectStore('categories', { keyPath: 'id' });
                store.createIndex('username', 'username', { unique: false });
            }

            // Budgets Store
            if (!dbInstance.objectStoreNames.contains('budgets')) {
                const store = dbInstance.createObjectStore('budgets', { keyPath: 'id' });
                store.createIndex('username', 'username', { unique: false });
            }
        };
    });
}

// --- Generic IndexedDB & Supabase CRUD Helper Wrappers ---
async function getItemsByUsername(storeName, username) {
    if (supabase) {
        const { data, error } = await supabase
            .from(storeName)
            .select('*')
            .eq('username', username);
        if (error) {
            console.error(`Supabase error reading from ${storeName}:`, error);
            throw error;
        }
        return data || [];
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index('username');
        const request = index.getAll(username);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function putItem(storeName, item) {
    if (supabase) {
        const { error } = await supabase
            .from(storeName)
            .upsert(item);
        if (error) {
            console.error(`Supabase error writing to ${storeName}:`, error);
            throw error;
        }
        return item;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(item);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Global functions for inline actions
function deleteItemGlobal(storeName, id) {
    return deleteItem(storeName, id);
}

async function deleteItem(storeName, id) {
    if (supabase) {
        const { error } = await supabase
            .from(storeName)
            .delete()
            .eq('id', id);
        if (error) {
            console.error(`Supabase error deleting from ${storeName}:`, error);
            throw error;
        }
        return;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function deleteItemsByUsername(storeName, username) {
    if (supabase) {
        const { error } = await supabase
            .from(storeName)
            .delete()
            .eq('username', username);
        if (error) {
            console.error(`Supabase error bulk deleting from ${storeName}:`, error);
            throw error;
        }
        return;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const index = store.index('username');
        const request = index.openCursor(IDBKeyRange.only(username));

        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// --- Password Encryption Security (Web Crypto API SHA-256) ---
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// --- Authentication & Recovery Controllers ---
async function registerUser(username, password, question, answer) {
    if (supabase) {
        const { data: existingUser, error: checkError } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .maybeSingle();
        if (checkError) {
            console.error("Supabase registration error (check):", checkError);
            throw checkError;
        }
        if (existingUser) {
            throw 'username_exists';
        }
        const hashedPassword = await hashPassword(password);
        const hashedAnswer = await hashPassword(answer.trim().toLowerCase());
        const { error: insertError } = await supabase
            .from('users')
            .insert({ 
                username, 
                password: hashedPassword,
                question,
                answer: hashedAnswer
            });
        if (insertError) {
            console.error("Supabase registration error (insert):", insertError);
            throw insertError;
        }
        return;
    }

    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction('users', 'readwrite');
        const store = transaction.objectStore('users');
        const checkRequest = store.get(username);

        checkRequest.onsuccess = async () => {
            if (checkRequest.result) {
                reject('username_exists');
            } else {
                const hashedPassword = await hashPassword(password);
                const hashedAnswer = await hashPassword(answer.trim().toLowerCase());
                const addRequest = store.add({ 
                    username, 
                    password: hashedPassword,
                    question,
                    answer: hashedAnswer
                });
                addRequest.onsuccess = () => resolve();
                addRequest.onerror = () => reject(addRequest.error);
            }
        };
        checkRequest.onerror = () => reject(checkRequest.error);
    });
}

async function validateLogin(username, password) {
    if (supabase) {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();
        if (error) {
            console.error("Supabase login error:", error);
            throw error;
        }
        if (!user) {
            return false;
        }
        const hashedPassword = await hashPassword(password);
        return user.password === hashedPassword;
    }

    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction('users', 'readonly');
        const store = transaction.objectStore('users');
        const request = store.get(username);

        request.onsuccess = async () => {
            const user = request.result;
            if (!user) {
                resolve(false);
            } else {
                const hashedPassword = await hashPassword(password);
                resolve(user.password === hashedPassword);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function validateRecovery(username, question, answer) {
    if (supabase) {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();
        if (error) {
            console.error("Supabase recovery check error:", error);
            throw error;
        }
        if (!user) {
            return 'user_not_found';
        }
        const hashedAnswer = await hashPassword(answer.trim().toLowerCase());
        if (user.question !== question || user.answer !== hashedAnswer) {
            return 'invalid_credentials';
        }
        return 'ok';
    }

    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction('users', 'readonly');
        const store = transaction.objectStore('users');
        const request = store.get(username);

        request.onsuccess = async () => {
            const user = request.result;
            if (!user) {
                resolve('user_not_found');
            } else {
                const hashedAnswer = await hashPassword(answer.trim().toLowerCase());
                if (user.question !== question || user.answer !== hashedAnswer) {
                    resolve('invalid_credentials');
                } else {
                    resolve('ok');
                }
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function resetPassword(username, newPassword) {
    if (supabase) {
        const hashedPassword = await hashPassword(newPassword);
        const { error } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('username', username);
        if (error) {
            console.error("Supabase reset password error:", error);
            throw error;
        }
        return;
    }

    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction('users', 'readwrite');
        const store = transaction.objectStore('users');
        const request = store.get(username);

        request.onsuccess = async () => {
            const user = request.result;
            if (!user) {
                reject('user_not_found');
            } else {
                const hashedPassword = await hashPassword(newPassword);
                user.password = hashedPassword;
                const updateRequest = store.put(user);
                updateRequest.onsuccess = () => resolve();
                updateRequest.onerror = () => reject(updateRequest.error);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// --- Toggle Password Fields Visibility ---
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
}

// --- Custom Toast Notification Engine ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'danger') iconClass = 'fa-circle-xmark';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span class="toast-message">${message}</span>
        <button type="button" class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.style.animation = `fadeOut 0.25s ease-out forwards`;
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = `fadeOut 0.25s ease-out forwards`;
            setTimeout(() => toast.remove(), 250);
        }
    }, 4000);
}

// --- Custom Confirmation Dialog Engine ---
let activeConfirmCallback = null;
let activeCancelCallback = null;

function showConfirmModal(title, message, onConfirm, onCancel = null) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMessage');
    
    if (!modal || !titleEl || !msgEl) return;

    titleEl.textContent = title;
    msgEl.textContent = message;

    activeConfirmCallback = onConfirm;
    activeCancelCallback = onCancel;

    openModal('confirmModal');
}

function handleConfirmModalAction(confirmed) {
    closeModal('confirmModal');
    if (confirmed && activeConfirmCallback) {
        activeConfirmCallback();
    } else if (!confirmed && activeCancelCallback) {
        activeCancelCallback();
    }
    activeConfirmCallback = null;
    activeCancelCallback = null;
}

// --- Data Loading & Seeding ---
async function loadUserData(username) {
    let userCategories = await getItemsByUsername('categories', username);
    
    // Seed default configuration on first registration login
    if (userCategories.length === 0) {
        const seedCategories = DEFAULT_CATEGORIES.map((c, i) => ({
            id: `cat-${username}-${i}-${Date.now()}`,
            username,
            name: c.name,
            color: c.color,
            icon: c.icon
        }));
        
        for (let cat of seedCategories) {
            await putItem('categories', cat);
        }
        userCategories = seedCategories;

        // Generate 6 months of historical transactions ending in the current calendar month
        const today = new Date();
        const seedTransactions = [];
        
        for (let m = 0; m < 6; m++) {
            const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const monthPrefix = `${y}-${mo}`;

            // Seeding Salary
            seedTransactions.push({
                id: `trans-${username}-sal-${m}-${Date.now()}`,
                username,
                description: 'Salário Mensal',
                amount: 5500.00,
                type: 'income',
                category: 'Salário',
                date: `${monthPrefix}-05`
            });

            // Seeding Rent
            seedTransactions.push({
                id: `trans-${username}-rent-${m}-${Date.now()}`,
                username,
                description: 'Aluguel do Apartamento',
                amount: 1500.00,
                type: 'expense',
                category: 'Moradia',
                date: `${monthPrefix}-10`
            });

            // Seeding grocery (varies slightly)
            seedTransactions.push({
                id: `trans-${username}-food-${m}-${Date.now()}`,
                username,
                description: 'Supermercado',
                amount: parseFloat((600.00 + (m * 10) - (Math.random() * 30)).toFixed(2)),
                type: 'expense',
                category: 'Alimentação',
                date: `${monthPrefix}-12`
            });

            // Seeding leisure
            seedTransactions.push({
                id: `trans-${username}-leisure-${m}-${Date.now()}`,
                username,
                description: 'Lazer & Cinema',
                amount: parseFloat((150.00 + (m * 25) + (Math.random() * 20)).toFixed(2)),
                type: 'expense',
                category: 'Lazer',
                date: `${monthPrefix}-15`
            });

            // Seeding transportation every other month
            if (m % 2 === 0) {
                seedTransactions.push({
                    id: `trans-${username}-trans-${m}-${Date.now()}`,
                    username,
                    description: 'Combustível Carro',
                    amount: 220.00,
                    type: 'expense',
                    category: 'Transporte',
                    date: `${monthPrefix}-14`
                });
            }
        }
        
        for (let trans of seedTransactions) {
            await putItem('transactions', trans);
        }

        // Seed demo budgets
        const seedBudgets = Object.keys(DEMO_BUDGETS).map(catName => ({
            id: `budget-${username}-${catName}`,
            username,
            category: catName,
            amount: DEMO_BUDGETS[catName]
        }));
        
        for (let bud of seedBudgets) {
            await putItem('budgets', bud);
        }
    }

    // Fetch user specific data from stores
    const userTransactions = await getItemsByUsername('transactions', username);
    const userBudgetsList = await getItemsByUsername('budgets', username);
    
    // Auto-migration for legacy dynamic budget IDs
    const userBudgets = {};
    for (let b of userBudgetsList) {
        const correctId = `budget-${username}-${b.category}`;
        if (b.id !== correctId) {
            await deleteItem('budgets', b.id);
            b.id = correctId;
            await putItem('budgets', b);
        }
        userBudgets[b.category] = b.amount;
    }

    // Update global state
    state.username = username;
    state.transactions = userTransactions;
    state.categories = userCategories;
    state.budgets = userBudgets;
}

// --- Reference Month Navigation Controllers ---
function initializeReferenceMonth() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    state.referenceMonth = `${year}-${month}`;
    
    updateActiveMonthLabel();
}

function updateActiveMonthLabel() {
    const parts = state.referenceMonth.split('-');
    const year = parts[0];
    const monthIndex = parseInt(parts[1]) - 1;
    const months = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const labelEl = document.getElementById('activeMonthLabel');
    if (labelEl) {
        labelEl.textContent = `${months[monthIndex]} de ${year}`;
    }
}

function changeReferenceMonth(offset) {
    const parts = state.referenceMonth.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // 0-indexed
    
    const d = new Date(year, month + offset, 1);
    const newYear = d.getFullYear();
    const newMonth = String(d.getMonth() + 1).padStart(2, '0');
    state.referenceMonth = `${newYear}-${newMonth}`;
    
    updateActiveMonthLabel();
    renderApp();
    showToast(`Visualizando: ${document.getElementById('activeMonthLabel').textContent}`, 'info');
}

// --- Application Core Bootstrapping ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initSupabase();
        await initDB();
        setupHeaderDate();
        loadGlobalSettings();
        initTheme();
        setupEventListeners();
        initializeReferenceMonth();
        
        // Session Check
        const sessionUser = sessionStorage.getItem('active_user');
        if (sessionUser) {
            await loginUserSession(sessionUser);
        } else {
            showAuthScreen();
        }
    } catch (e) {
        console.error("Initialization error:", e);
    } finally {
        // Fade out and remove loading screen overlay
        const loader = document.getElementById('loadingScreen');
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => {
                loader.style.display = 'none';
            }, 400);
        }
    }
});

function loadGlobalSettings() {
    const savedTheme = localStorage.getItem('financly_theme');
    if (savedTheme) {
        state.theme = savedTheme;
    }
}

function saveGlobalSettings() {
    localStorage.setItem('financly_theme', state.theme);
}

// --- Session Handler Functions ---
async function loginUserSession(username) {
    sessionStorage.setItem('active_user', username);
    state.username = username;
    document.getElementById('activeUsername').textContent = username;
    
    await loadUserData(username);
    initializeReferenceMonth();
    
    // Toggle active layout states
    document.body.classList.remove('logged-out');
    document.body.classList.add('logged-in');
    
    renderApp();
    showToast(`Bem-vindo de volta, ${username}!`, 'success');
}

function logoutUserSession() {
    sessionStorage.removeItem('active_user');
    state.username = null;
    state.transactions = [];
    state.categories = [];
    state.budgets = {};
    
    showAuthScreen();
    showToast('Sessão encerrada com sucesso.', 'info');
}

function showAuthScreen() {
    document.body.classList.remove('logged-in');
    document.body.classList.add('logged-out');
    
    // Clear forms and errors
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    document.getElementById('recoveryForm').reset();
    
    // Reset eye toggle icons
    document.querySelectorAll('.password-toggle-btn i').forEach(icon => {
        icon.className = 'fa-solid fa-eye';
    });
    document.querySelectorAll('.password-input-wrapper input').forEach(input => {
        input.type = 'password';
    });

    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerUserError').style.display = 'none';
    document.getElementById('registerPassError').style.display = 'none';
    document.getElementById('recoveryUserError').style.display = 'none';
    document.getElementById('recoveryAnswerError').style.display = 'none';
    document.getElementById('recoveryPassError').style.display = 'none';
}

// --- Date Formatter Helper ---
function setupHeaderDate() {
    const headerDateElement = document.getElementById('headerDate');
    if (headerDateElement) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        headerDateElement.textContent = new Date().toLocaleDateString('pt-BR', options);
    }
}

function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return new Date(dateStr).toLocaleDateString('pt-BR');
}

// --- Theme Controller ---
function initTheme() {
    const body = document.body;
    const themeBtn = document.getElementById('themeToggle');
    
    if (state.theme === 'light') {
        body.classList.remove('dark-theme');
        body.classList.add('light-theme');
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
        body.classList.remove('light-theme');
        body.classList.add('dark-theme');
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
}

function toggleTheme() {
    const body = document.body;
    const themeBtn = document.getElementById('themeToggle');
    
    if (body.classList.contains('dark-theme')) {
        body.classList.remove('dark-theme');
        body.classList.add('light-theme');
        state.theme = 'light';
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
        body.classList.remove('light-theme');
        body.classList.add('dark-theme');
        state.theme = 'dark';
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
    
    saveGlobalSettings();
    renderCharts();
}

// --- Modals View controller ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// --- Rendering Engine ---
function renderApp() {
    renderDashboardSummary();
    renderCategoriesDropdowns();
    renderCategoriesListModal();
    renderBudgets();
    renderBudgetsModalList();
    renderTransactionsTable();
    renderCharts();
}

// 1. Summary Metrics Card Panel (Calculates Month Specific Income/Expenses and Total Balance)
function renderDashboardSummary() {
    let allTimeIncome = 0;
    let allTimeExpense = 0;
    let refMonthIncome = 0;
    let refMonthExpense = 0;

    const activeMonthKey = state.referenceMonth;

    state.transactions.forEach(t => {
        const amount = t.amount;
        const type = t.type;
        const tMonthKey = t.date.substring(0, 7);

        // Cumulative balance tracking up to the active reference month
        if (tMonthKey <= activeMonthKey) {
            if (type === 'income') {
                allTimeIncome += amount;
            } else if (type === 'expense') {
                allTimeExpense += amount;
            }
        }

        // Active month specific tracking
        if (tMonthKey === activeMonthKey) {
            if (type === 'income') {
                refMonthIncome += amount;
            } else if (type === 'expense') {
                refMonthExpense += amount;
            }
        }
    });

    const overallBalance = allTimeIncome - allTimeExpense;
    
    let refMonthSavingsRate = 0;
    if (refMonthIncome > 0) {
        refMonthSavingsRate = Math.max(0, ((refMonthIncome - refMonthExpense) / refMonthIncome) * 100);
    }

    document.getElementById('totalBalance').textContent = formatCurrency(overallBalance);
    document.getElementById('totalIncome').textContent = formatCurrency(refMonthIncome);
    document.getElementById('totalExpense').textContent = formatCurrency(refMonthExpense);
    document.getElementById('savingsRate').textContent = `${refMonthSavingsRate.toFixed(1)}%`;
}

function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// 2. Select Dropdowns Population
function renderCategoriesDropdowns() {
    const transCategorySelect = document.getElementById('transCategory');
    const filterCategorySelect = document.getElementById('filterCategory');
    const budgetCategorySelect = document.getElementById('budgetCategory');

    const currentFilterVal = filterCategorySelect ? filterCategorySelect.value : 'all';

    if (transCategorySelect) {
        transCategorySelect.innerHTML = state.categories
            .map(c => `<option value="${c.name}">${c.name}</option>`)
            .join('');
    }

    if (filterCategorySelect) {
        let filterHtml = '<option value="all">Todas as categorias</option>';
        filterHtml += state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        filterCategorySelect.innerHTML = filterHtml;
        filterCategorySelect.value = currentFilterVal;
    }

    if (budgetCategorySelect) {
        budgetCategorySelect.innerHTML = state.categories
            .map(c => `<option value="${c.name}">${c.name}</option>`)
            .join('');
    }
}

// 3. Category Settings UI List
function renderCategoriesListModal() {
    const listContainer = document.getElementById('modalCategoriesList');
    if (!listContainer) return;

    if (state.categories.length === 0) {
        listContainer.innerHTML = '<p class="empty-state-message">Nenhuma categoria cadastrada.</p>';
        return;
    }

    listContainer.innerHTML = state.categories.map(c => {
        return `
            <div class="category-item animate-fade">
                <div class="category-item-info">
                    <span class="category-color-bubble" style="background-color: ${c.color}">
                        <i class="fa-solid ${c.icon || 'fa-tag'}"></i>
                    </span>
                    <span>${c.name}</span>
                </div>
                <button type="button" class="category-item-delete" onclick="deleteCategory('${c.id}', '${c.name}')" title="Excluir Categoria">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

// 4. Monthly Budgets Dashboard bars (Filtered by state.referenceMonth)
function renderBudgets() {
    const container = document.getElementById('budgetsListContainer');
    if (!container) return;

    const currentMonth = state.referenceMonth;
    const budgetKeys = Object.keys(state.budgets);

    if (budgetKeys.length === 0) {
        container.innerHTML = '<p class="empty-state-message">Nenhum limite de orçamento configurado ainda. Clique em "Metas de Orçamento" para definir limites!</p>';
        return;
    }

    const monthlySpending = {};
    state.transactions.forEach(t => {
        if (t.type === 'expense' && t.date.substring(0, 7) === currentMonth) {
            monthlySpending[t.category] = (monthlySpending[t.category] || 0) + t.amount;
        }
    });

    container.innerHTML = budgetKeys.map(catName => {
        const limit = state.budgets[catName];
        if (limit <= 0) return '';
        
        const spent = monthlySpending[catName] || 0;
        const percent = Math.min(100, (spent / limit) * 100);
        const categoryData = state.categories.find(c => c.name === catName) || { color: '#8b5cf6' };
        
        const isOverBudget = spent > limit;
        
        return `
            <div class="budget-progress-item animate-fade">
                <div class="budget-progress-header">
                    <span class="category-name">
                        <span class="dot" style="background-color: ${categoryData.color}"></span>
                        ${catName}
                    </span>
                    <span class="budget-values">
                        <strong>${formatCurrency(spent)}</strong> de ${formatCurrency(limit)}
                    </span>
                </div>
                <div class="budget-progress-bar-bg">
                    <div class="budget-progress-bar-fill" style="width: ${percent}%; background-color: ${categoryData.color}"></div>
                </div>
                ${isOverBudget ? `
                    <span class="budget-warning-text">
                        <i class="fa-solid fa-triangle-exclamation"></i> Limite mensal estourado!
                    </span>
                ` : ''}
            </div>
        `;
    }).join('');
}

// 5. Budgets Settings list inside modal
function renderBudgetsModalList() {
    const container = document.getElementById('modalBudgetsList');
    if (!container) return;

    const budgetKeys = Object.keys(state.budgets);

    if (budgetKeys.length === 0) {
        container.innerHTML = '<p class="empty-state-message">Nenhuma meta configurada ainda.</p>';
        return;
    }

    container.innerHTML = budgetKeys.map(catName => {
        const limit = state.budgets[catName];
        return `
            <div class="budget-item animate-fade">
                <div class="budget-item-info">
                    <span class="title">${catName}</span>
                    <span class="amount">Limite: ${formatCurrency(limit)}</span>
                </div>
                <button type="button" class="category-item-delete" onclick="deleteBudget('${catName}')" title="Excluir Meta">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

// 6. Filter & Render Transactions table rows
function renderTransactionsTable() {
    const listBody = document.getElementById('transactionsList');
    const countBadge = document.getElementById('transactionsCount');
    const emptyState = document.getElementById('emptyState');
    const tableElement = document.getElementById('transactionsTable');

    if (!listBody) return;

    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    const typeFilter = document.getElementById('filterType').value;
    const catFilter = document.getElementById('filterCategory').value;
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;

    let filtered = state.transactions.filter(t => {
        const matchesSearch = t.description.toLowerCase().includes(query) || 
                              t.category.toLowerCase().includes(query);
        const matchesType = typeFilter === 'all' || t.type === typeFilter;
        const matchesCategory = catFilter === 'all' || t.category === catFilter;

        let matchesStartDate = true;
        if (startDate) {
            matchesStartDate = t.date >= startDate;
        }
        
        let matchesEndDate = true;
        if (endDate) {
            matchesEndDate = t.date <= endDate;
        }

        return matchesSearch && matchesType && matchesCategory && matchesStartDate && matchesEndDate;
    });

    // Sorting evaluation
    filtered.sort((a, b) => {
        let valA = a[state.sort.field];
        let valB = b[state.sort.field];

        if (state.sort.field === 'amount') {
            return state.sort.direction === 'asc' ? valA - valB : valB - valA;
        }
        
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();

        if (valA < valB) return state.sort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return state.sort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    countBadge.textContent = `${filtered.length} transaç${filtered.length === 1 ? 'ão' : 'ões'}`;

    if (filtered.length === 0) {
        listBody.innerHTML = '';
        tableElement.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    tableElement.style.display = 'table';
    emptyState.style.display = 'none';

    listBody.innerHTML = filtered.map(t => {
        const cat = state.categories.find(c => c.name === t.category) || { color: '#6b7280', icon: 'fa-tag' };
        const amountClass = t.type === 'income' ? 'amount-income' : 'amount-expense';
        const amountPrefix = t.type === 'income' ? '+' : '-';
        
        return `
            <tr class="animate-fade">
                <td class="col-date" data-label="Data">${formatDateBR(t.date)}</td>
                <td class="col-desc" data-label="Descrição"><strong>${t.description}</strong></td>
                <td class="col-cat" data-label="Categoria">
                    <span class="category-tag" style="background-color: ${cat.color}">
                        <i class="fa-solid ${cat.icon || 'fa-tag'}"></i> ${t.category}
                    </span>
                </td>
                <td class="col-amount ${amountClass}" data-label="Valor">${amountPrefix} ${formatCurrency(t.amount)}</td>
                <td class="col-actions" data-label="Ações">
                    <button class="btn-icon edit-action" onclick="openEditTransactionModal('${t.id}')" title="Editar">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                    <button class="btn-icon delete-action" onclick="deleteTransaction('${t.id}')" title="Excluir">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 7. Graphic updates via ChartJS (Supports 12-Month Line Scale and Dynamic Offset time-travel)
function renderCharts() {
    if (!state.referenceMonth) return;
    
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#9ca3af' : '#475569';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';
    const fontConfig = { family: 'Inter', size: 11 };

    // --- Chart 1: Cash Flow (Expanded to 12 Months, Timezone-Proofed) ---
    const cashFlowCtx = document.getElementById('cashFlowChart');
    if (cashFlowCtx) {
        if (cashFlowChartInstance) {
            cashFlowChartInstance.destroy();
        }

        const monthsList = [];
        const parts = state.referenceMonth.split('-');
        const refYear = parseInt(parts[0]);
        const refMonth = parseInt(parts[1]) - 1; // 0-indexed
        
        const targetDate = new Date(refYear, refMonth, 1);
        
        // Generate 12 months ending at the referenceMonth
        for (let i = 11; i >= 0; i--) {
            const d = new Date(targetDate.getFullYear(), targetDate.getMonth() - i, 1);
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            
            // local calendar dates instead of ISO timezone offsets
            monthsList.push({
                label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
                key: `${y}-${mo}`
            });
        }

        // Display range labels on header
        const rangeText = `${monthsList[0].label.charAt(0).toUpperCase() + monthsList[0].label.slice(1)} - ${monthsList[11].label.charAt(0).toUpperCase() + monthsList[11].label.slice(1)}`;
        const periodEl = document.getElementById('chartPeriodLabel');
        if (periodEl) {
            periodEl.textContent = rangeText;
        }

        const incomeData = Array(12).fill(0);
        const expenseData = Array(12).fill(0);

        state.transactions.forEach(t => {
            const tMonth = t.date.substring(0, 7);
            const idx = monthsList.findIndex(m => m.key === tMonth);
            if (idx !== -1) {
                if (t.type === 'income') {
                    incomeData[idx] += t.amount;
                } else if (t.type === 'expense') {
                    expenseData[idx] += t.amount;
                }
            }
        });

        cashFlowChartInstance = new Chart(cashFlowCtx, {
            type: 'line',
            data: {
                labels: monthsList.map(m => m.label.charAt(0).toUpperCase() + m.label.slice(1)),
                datasets: [
                    {
                        label: 'Receitas',
                        data: incomeData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981'
                    },
                    {
                        label: 'Despesas',
                        data: expenseData,
                        borderColor: '#f43f5e',
                        backgroundColor: 'rgba(244, 63, 94, 0.08)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: '#f43f5e'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: textColor, font: fontConfig } },
                    tooltip: {
                        backgroundColor: isDark ? '#111324' : '#ffffff',
                        titleColor: isDark ? '#ffffff' : '#0f172a',
                        bodyColor: isDark ? '#e2e8f0' : '#475569',
                        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${formatCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: fontConfig } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, font: fontConfig } }
                }
            }
        });
    }

    // --- Chart 2: Category distribution (Doughnut - Filtered by state.referenceMonth) ---
    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx) {
        if (categoryChartInstance) {
            categoryChartInstance.destroy();
        }

        const currentMonth = state.referenceMonth;
        const categoriesSpend = {};
        
        state.transactions.forEach(t => {
            if (t.type === 'expense' && t.date.substring(0, 7) === currentMonth) {
                categoriesSpend[t.category] = (categoriesSpend[t.category] || 0) + t.amount;
            }
        });

        const activeLabels = Object.keys(categoriesSpend);
        const activeData = activeLabels.map(label => categoriesSpend[label]);
        const activeColors = activeLabels.map(label => {
            const cat = state.categories.find(c => c.name === label);
            return cat ? cat.color : '#6b7280';
        });

        if (activeLabels.length === 0) {
            categoryChartInstance = new Chart(categoryCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Sem Despesas'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: textColor, font: fontConfig } },
                        tooltip: { enabled: false }
                    },
                    cutout: '70%'
                }
            });
        } else {
            categoryChartInstance = new Chart(categoryCtx, {
                type: 'doughnut',
                data: {
                    labels: activeLabels,
                    datasets: [{
                        data: activeData,
                        backgroundColor: activeColors,
                        hoverOffset: 6,
                        borderWidth: isDark ? 2 : 1,
                        borderColor: isDark ? '#0c0d19' : '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: textColor, font: fontConfig } },
                        tooltip: {
                            backgroundColor: isDark ? '#111324' : '#ffffff',
                            titleColor: isDark ? '#ffffff' : '#0f172a',
                            bodyColor: isDark ? '#e2e8f0' : '#475569',
                            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                            borderWidth: 1,
                            callbacks: {
                                label: function(context) {
                                    return ` ${context.label}: ${formatCurrency(context.parsed)}`;
                                }
                            }
                        }
                    },
                    cutout: '70%'
                }
            });
        }
    }
}

// --- CRUD Controllers (IndexedDB Powered) ---

// 1. Transaction controllers
function openEditTransactionModal(id) {
    const t = state.transactions.find(item => item.id === id);
    if (!t) return;

    document.getElementById('modalTitle').textContent = 'Editar Transação';
    document.getElementById('transactionId').value = t.id;
    document.getElementById('transDescription').value = t.description;
    document.getElementById('transAmount').value = t.amount;
    document.getElementById('transDate').value = t.date;
    document.getElementById('transCategory').value = t.category;

    if (t.type === 'income') {
        document.getElementById('typeIncome').checked = true;
    } else {
        document.getElementById('typeExpense').checked = true;
    }

    clearErrors();
    openModal('transactionModal');
}

function deleteTransaction(id) {
    showConfirmModal(
        'Excluir Transação',
        'Tem certeza de que deseja excluir esta transação do seu histórico?',
        async () => {
            try {
                await deleteItem(window.deleteItemGlobal ? 'transactions' : 'transactions', id);
                state.transactions = state.transactions.filter(t => t.id !== id);
                renderApp();
                showToast('Transação excluída com sucesso.', 'success');
            } catch (e) {
                console.error("Failed to delete transaction:", e);
                showToast('Não foi possível excluir a transação.', 'danger');
            }
        }
    );
}

async function handleTransactionFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('transactionId').value;
    const type = document.querySelector('input[name="transactionType"]:checked').value;
    const description = document.getElementById('transDescription').value.trim();
    const amountVal = parseFloat(document.getElementById('transAmount').value);
    const date = document.getElementById('transDate').value;
    const category = document.getElementById('transCategory').value;

    let hasErrors = false;
    clearErrors();

    if (!description) {
        document.getElementById('descError').style.display = 'block';
        hasErrors = true;
    }
    if (isNaN(amountVal) || amountVal <= 0) {
        document.getElementById('amountError').style.display = 'block';
        hasErrors = true;
    }
    if (!date) {
        document.getElementById('dateError').style.display = 'block';
        hasErrors = true;
    }

    if (hasErrors) return;

    const transactionData = {
        id: id || `trans-${state.username}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        username: state.username,
        type,
        description,
        amount: amountVal,
        date,
        category
    };

    try {
        await putItem('transactions', transactionData);
        
        if (id) {
            const idx = state.transactions.findIndex(t => t.id === id);
            if (idx !== -1) {
                state.transactions[idx] = transactionData;
            }
            showToast('Transação atualizada com sucesso.', 'success');
        } else {
            state.transactions.push(transactionData);
            
            // Auto align dashboard referenceMonth to added transaction month
            const newMonthKey = date.substring(0, 7);
            if (newMonthKey !== state.referenceMonth) {
                state.referenceMonth = newMonthKey;
                updateActiveMonthLabel();
            }
            
            showToast('Nova transação adicionada com sucesso.', 'success');
        }

        closeModal('transactionModal');
        renderApp();
    } catch (err) {
        console.error("Error saving transaction:", err);
        showToast('Erro ao salvar transação.', 'danger');
    }
}

function clearErrors() {
    document.getElementById('descError').style.display = 'none';
    document.getElementById('amountError').style.display = 'none';
    document.getElementById('dateError').style.display = 'none';
}

// 2. Custom Category controllers
async function handleCategoryFormSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('newCategoryName');
    const colorInput = document.getElementById('newCategoryColor');
    const iconInput = document.getElementById('newCategoryIcon');

    const name = nameInput.value.trim();
    const color = colorInput.value;
    const icon = iconInput.value;

    if (!name) return;

    const exists = state.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        showToast('Uma categoria com este nome já existe!', 'warning');
        return;
    }

    const newCategory = {
        id: `cat-${state.username}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        username: state.username,
        name,
        color,
        icon
    };

    try {
        await putItem('categories', newCategory);
        state.categories.push(newCategory);
        
        nameInput.value = '';
        renderCategoriesDropdowns();
        renderCategoriesListModal();
        renderApp();
        showToast(`Categoria "${name}" criada com sucesso!`, 'success');
    } catch (err) {
        console.error("Error saving category:", err);
        showToast('Erro ao salvar categoria.', 'danger');
    }
}

function deleteCategory(id, name) {
    showConfirmModal(
        'Excluir Categoria',
        `Deseja realmente excluir a categoria "${name}"? Nota: Transações antigas nesta categoria não serão apagadas, mas perderão a formatação colorida.`,
        async () => {
            try {
                await deleteItem('categories', id);
                state.categories = state.categories.filter(c => c.id !== id);
                
                // Delete associated budget if any
                if (state.budgets[name]) {
                    const budgetsList = await getItemsByUsername('budgets', state.username);
                    const targetBudget = budgetsList.find(b => b.category === name);
                    if (targetBudget) {
                        await deleteItem('budgets', targetBudget.id);
                    }
                    delete state.budgets[name];
                }
                
                renderCategoriesDropdowns();
                renderCategoriesListModal();
                renderApp();
                showToast(`Categoria "${name}" removida com sucesso.`, 'success');
            } catch (e) {
                console.error("Failed to delete category:", e);
                showToast('Erro ao excluir categoria.', 'danger');
            }
        }
    );
}

// 3. Budgets limits controllers
async function handleBudgetFormSubmit(e) {
    e.preventDefault();
    const category = document.getElementById('budgetCategory').value;
    const amountVal = parseFloat(document.getElementById('budgetAmount').value);

    if (isNaN(amountVal) || amountVal < 0) {
        showToast('Insira um limite orçamentário válido.', 'warning');
        return;
    }

    const budgetData = {
        id: `budget-${state.username}-${category}`,
        username: state.username,
        category,
        amount: amountVal
    };

    try {
        await putItem('budgets', budgetData);
        state.budgets[category] = amountVal;

        document.getElementById('budgetAmount').value = '';
        renderBudgets();
        renderBudgetsModalList();
        showToast(`Limite orçamentário definido para "${category}".`, 'success');
    } catch (err) {
        console.error("Error saving budget limits:", err);
        showToast('Erro ao salvar metas.', 'danger');
    }
}

function deleteBudget(categoryName) {
    showConfirmModal(
        'Excluir Meta Orçamentária',
        `Deseja realmente excluir o limite mensal de gastos para "${categoryName}"?`,
        async () => {
            try {
                const budgetId = `budget-${state.username}-${categoryName}`;
                await deleteItem('budgets', budgetId);
                delete state.budgets[categoryName];
                
                renderBudgets();
                renderBudgetsModalList();
                showToast('Meta orçamentária removida.', 'info');
            } catch (e) {
                console.error("Failed to delete budget:", e);
                showToast('Erro ao excluir meta.', 'danger');
            }
        }
    );
}

// --- Data Portability Controllers (User specific imports & backups) ---
async function exportData() {
    try {
        const periodType = document.getElementById('exportPeriodSelect').value;
        const format = document.getElementById('exportFormatSelect').value;
        
        let allTransactions = await getItemsByUsername('transactions', state.username);
        const categories = await getItemsByUsername('categories', state.username);
        const budgets = await getItemsByUsername('budgets', state.username);
        
        let filteredTransactions = [...allTransactions];
        let filenameSuffix = 'tudo';

        if (periodType === 'month') {
            const selectedMonth = document.getElementById('exportMonthInput').value; // "YYYY-MM"
            if (!selectedMonth) {
                showToast('Selecione o mês que deseja baixar.', 'warning');
                return;
            }
            filteredTransactions = allTransactions.filter(t => t.date.substring(0, 7) === selectedMonth);
            filenameSuffix = `mes_${selectedMonth}`;
        } else if (periodType === 'custom') {
            const start = document.getElementById('exportStartDate').value;
            const end = document.getElementById('exportEndDate').value;
            if (!start || !end) {
                showToast('Selecione as datas de início e fim.', 'warning');
                return;
            }
            if (start > end) {
                showToast('A data de início não pode ser maior que a de fim.', 'warning');
                return;
            }
            filteredTransactions = allTransactions.filter(t => t.date >= start && t.date <= end);
            filenameSuffix = `periodo_${start}_ate_${end}`;
        }

        if (filteredTransactions.length === 0) {
            showToast('Nenhuma transação encontrada no período selecionado.', 'warning');
            return;
        }

        if (format === 'json') {
            // JSON BACKUP
            const backupData = {
                username: state.username,
                transactions: filteredTransactions,
                categories,
                budgets
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `financly_backup_${state.username}_${filenameSuffix}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToast('Backup JSON baixado com sucesso!', 'success');
        } else if (format === 'csv') {
            // CSV RELATORIO (Excel Brazilian style)
            // Column Header: Data;Descrição;Categoria;Tipo;Valor
            let csvContent = "\uFEFF"; // UTF-8 BOM
            csvContent += "Data;Descrição;Categoria;Tipo;Valor\r\n";
            
            filteredTransactions.sort((a, b) => b.date.localeCompare(a.date)); // Sort newest first
            
            filteredTransactions.forEach(t => {
                const dateBr = formatDateBR(t.date);
                const desc = t.description.replace(/;/g, ','); // Sanitise semicolons
                const cat = t.category;
                const type = t.type === 'income' ? 'Receita' : 'Despesa';
                const val = t.amount.toFixed(2).replace('.', ','); // comma decimals
                
                csvContent += `${dateBr};${desc};${cat};${type};${val}\r\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", url);
            downloadAnchor.setAttribute("download", `financly_relatorio_${state.username}_${filenameSuffix}.csv`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToast('Planilha CSV baixada com sucesso!', 'success');
        } else if (format === 'pdf') {
            // PDF PRINTABLE SUMMARY REPORT
            exportPDF(filteredTransactions, filenameSuffix);
        }
    } catch (e) {
        console.error("Export error:", e);
        showToast('Erro ao carregar dados do banco para exportação.', 'danger');
    }
}

// --- PDF Builder Layout Engine (Uses Native Print Manager) ---
function exportPDF(filteredTransactions, filenameSuffix) {
    if (typeof html2pdf !== 'undefined') {
        const element = document.createElement('div');
        element.style.padding = '20px';
        element.style.background = '#ffffff';
        element.style.color = '#1e293b';
        element.style.fontFamily = "'Inter', sans-serif";
        
        // Calculate metrics
        let income = 0;
        let expense = 0;
        filteredTransactions.forEach(t => {
            if (t.type === 'income') income += t.amount;
            else expense += t.amount;
        });
        const balance = income - expense;

        const periodType = document.getElementById('exportPeriodSelect').value;
        let periodLabel = 'Todo o Histórico';
        if (periodType === 'month') {
            const parts = document.getElementById('exportMonthInput').value.split('-');
            if (parts.length === 2) {
                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                periodLabel = `${months[parseInt(parts[1])-1]} de ${parts[0]}`;
            }
        } else if (periodType === 'custom') {
            const start = formatDateBR(document.getElementById('exportStartDate').value);
            const end = formatDateBR(document.getElementById('exportEndDate').value);
            periodLabel = `${start} a ${end}`;
        }

        const categorySums = {};
        filteredTransactions.forEach(t => {
            if (t.type === 'expense') {
                categorySums[t.category] = (categorySums[t.category] || 0) + t.amount;
            }
        });

        let reportHtml = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #334155;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 25px;">
                    <div style="font-size: 1.6rem; font-weight: 700; color: #8b5cf6; display: flex; align-items: center; gap: 8px;">
                        <span style="background: #8b5cf6; color: #ffffff; width: 34px; height: 34px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.2rem;">F</span>
                        <span>Financly</span>
                    </div>
                    <div style="text-align: right;">
                        <h1 style="margin: 0; font-size: 1.3rem; color: #0f172a;">Resumo Financeiro</h1>
                        <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #64748b;">Usuário: <strong>${state.username}</strong> | Período: <strong>${periodLabel}</strong></p>
                    </div>
                </div>

                <div style="display: flex; gap: 15px; margin-bottom: 30px;">
                    <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #f8fafc;">
                        <h3 style="margin: 0 0 6px 0; font-size: 0.72rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Saldo do Período</h3>
                        <div style="font-size: 1.3rem; font-weight: 700; color: #0f172a;">${formatCurrency(balance)}</div>
                    </div>
                    <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #f8fafc;">
                        <h3 style="margin: 0 0 6px 0; font-size: 0.72rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Total Receitas</h3>
                        <div style="font-size: 1.3rem; font-weight: 700; color: #10b981;">${formatCurrency(income)}</div>
                    </div>
                    <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #f8fafc;">
                        <h3 style="margin: 0 0 6px 0; font-size: 0.72rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Total Despesas</h3>
                        <div style="font-size: 1.3rem; font-weight: 700; color: #f43f5e;">${formatCurrency(expense)}</div>
                    </div>
                </div>

                <div style="font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 25px 0 12px 0; border-left: 4px solid #8b5cf6; padding-left: 8px;">Despesas por Categoria</div>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 0.82rem;">
                    <thead>
                        <tr style="border-bottom: 1.5px solid #cbd5e1; background: #f1f5f9;">
                            <th style="text-align: left; padding: 10px;">Categoria</th>
                            <th style="text-align: left; padding: 10px;">Total Gasto</th>
                            <th style="text-align: left; padding: 10px;">Proporção (%)</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        const categoriesList = Object.keys(categorySums);
        if (categoriesList.length === 0) {
            reportHtml += `<tr><td colspan="3" style="text-align: center; padding: 10px; color: #94a3b8;">Nenhuma despesa registrada neste período.</td></tr>`;
        } else {
            categoriesList.sort((a,b) => categorySums[b] - categorySums[a]);
            categoriesList.forEach(cat => {
                const amt = categorySums[cat];
                const pct = expense > 0 ? ((amt / expense) * 100).toFixed(1) : 0;
                reportHtml += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px;"><strong>${cat}</strong></td>
                        <td style="padding: 10px;">${formatCurrency(amt)}</td>
                        <td style="padding: 10px;">${pct}%</td>
                    </tr>
                `;
            });
        }

        reportHtml += `
                    </tbody>
                </table>

                <div style="font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 25px 0 12px 0; border-left: 4px solid #8b5cf6; padding-left: 8px;">Detalhamento das Transações</div>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 0.82rem;">
                    <thead>
                        <tr style="border-bottom: 1.5px solid #cbd5e1; background: #f1f5f9;">
                            <th style="text-align: left; padding: 10px;">Data</th>
                            <th style="text-align: left; padding: 10px;">Descrição</th>
                            <th style="text-align: left; padding: 10px;">Categoria</th>
                            <th style="text-align: left; padding: 10px;">Tipo</th>
                            <th style="text-align: left; padding: 10px;">Valor</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        filteredTransactions.sort((a,b) => b.date.localeCompare(a.date));
        filteredTransactions.forEach(t => {
            const amtColor = t.type === 'income' ? '#10b981' : '#f43f5e';
            const typeLabel = t.type === 'income' ? 'Receita' : 'Despesa';
            const tagBg = t.type === 'income' ? '#d1fae5' : '#ffe4e6';
            const tagColor = t.type === 'income' ? '#065f46' : '#9f1239';
            
            reportHtml += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px;">${formatDateBR(t.date)}</td>
                    <td style="padding: 10px;"><strong>${t.description}</strong></td>
                    <td style="padding: 10px;">${t.category}</td>
                    <td style="padding: 10px;"><span style="padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; background: ${tagBg}; color: ${tagColor};">${typeLabel}</span></td>
                    <td style="padding: 10px; color: ${amtColor}; font-weight: 700;">${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}</td>
                </tr>
            `;
        });

        reportHtml += `
                    </tbody>
                </table>

                <div style="margin-top: 40px; text-align: center; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                    Relatório oficial baixado digitalmente do Financly em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.
                </div>
            </div>
        `;

        element.innerHTML = reportHtml;

        const opt = {
            margin:       10,
            filename:     `financly_relatorio_${state.username}_${filenameSuffix}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, logging: false, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        showToast('Iniciando o download do PDF...', 'info');
        html2pdf().set(opt).from(element).save().then(() => {
            showToast('Download do PDF concluído!', 'success');
        }).catch(err => {
            console.error("PDF Download error, falling back to print:", err);
            exportPDFPrintFallback(filteredTransactions, filenameSuffix);
        });
    } else {
        exportPDFPrintFallback(filteredTransactions, filenameSuffix);
    }
}

function exportPDFPrintFallback(filteredTransactions, filenameSuffix) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Erro ao abrir popup de impressão. Permita popups no navegador.', 'danger');
        return;
    }

    // Calculate metrics
    let income = 0;
    let expense = 0;
    filteredTransactions.forEach(t => {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
    });
    const balance = income - expense;

    // Period formatting labels
    const periodType = document.getElementById('exportPeriodSelect').value;
    let periodLabel = 'Todo o Histórico';
    if (periodType === 'month') {
        const parts = document.getElementById('exportMonthInput').value.split('-');
        if (parts.length === 2) {
            const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            periodLabel = `${months[parseInt(parts[1])-1]} de ${parts[0]}`;
        }
    } else if (periodType === 'custom') {
        const start = formatDateBR(document.getElementById('exportStartDate').value);
        const end = formatDateBR(document.getElementById('exportEndDate').value);
        periodLabel = `${start} a ${end}`;
    }

    // Category summations
    const categorySums = {};
    filteredTransactions.forEach(t => {
        if (t.type === 'expense') {
            categorySums[t.category] = (categorySums[t.category] || 0) + t.amount;
        }
    });

    let html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Relatório Financeiro - ${state.username} - ${filenameSuffix}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            body {
                font-family: 'Inter', sans-serif;
                color: #1e293b;
                padding: 40px;
                margin: 0;
                background: #ffffff;
                line-height: 1.5;
            }
            .report-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 1.6rem;
                font-weight: 700;
                color: #8b5cf6;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .logo-wallet {
                background: #8b5cf6;
                color: #ffffff;
                width: 34px;
                height: 34px;
                border-radius: 8px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-weight: 800;
                font-size: 1.2rem;
            }
            .report-title {
                text-align: right;
            }
            .report-title h1 {
                margin: 0;
                font-size: 1.4rem;
                color: #0f172a;
            }
            .report-title p {
                margin: 5px 0 0 0;
                font-size: 0.88rem;
                color: #64748b;
            }
            .metrics-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 20px;
                margin-bottom: 35px;
            }
            .metric-card {
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 16px;
                background: #f8fafc;
            }
            .metric-card h3 {
                margin: 0 0 8px 0;
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #64748b;
            }
            .metric-card .value {
                font-size: 1.5rem;
                font-weight: 700;
                color: #0f172a;
            }
            .metric-card .value.income { color: #10b981; }
            .metric-card .value.expense { color: #f43f5e; }
            
            .section-title {
                font-size: 1.05rem;
                font-weight: 700;
                color: #0f172a;
                margin: 35px 0 15px 0;
                border-left: 4px solid #8b5cf6;
                padding-left: 10px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 30px;
                font-size: 0.88rem;
            }
            th {
                background: #f1f5f9;
                color: #475569;
                text-align: left;
                padding: 12px 14px;
                font-weight: 600;
                border-bottom: 1.5px solid #cbd5e1;
            }
            td {
                padding: 10px 14px;
                border-bottom: 1px solid #e2e8f0;
                color: #334155;
            }
            tr:last-child td {
                border-bottom: none;
            }
            .amount-inc { color: #10b981; font-weight: 700; }
            .amount-exp { color: #f43f5e; font-weight: 700; }
            .type-tag {
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.72rem;
                font-weight: 700;
                display: inline-block;
            }
            .type-tag.inc { background: #d1fae5; color: #065f46; }
            .type-tag.exp { background: #ffe4e6; color: #9f1239; }
            
            .footer {
                margin-top: 60px;
                text-align: center;
                font-size: 0.75rem;
                color: #94a3b8;
                border-top: 1px solid #e2e8f0;
                padding-top: 20px;
            }
            @media print {
                body { padding: 0; }
            }
        </style>
    </head>
    <body>
        <div class="report-header">
            <div class="logo">
                <span class="logo-wallet">F</span>
                <span>Financly</span>
            </div>
            <div class="report-title">
                <h1>Resumo Financeiro</h1>
                <p>Usuário: <strong>${state.username}</strong> | Período: <strong>${periodLabel}</strong></p>
            </div>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <h3>Saldo do Período</h3>
                <div class="value">${formatCurrency(balance)}</div>
            </div>
            <div class="metric-card">
                <h3>Total Receitas</h3>
                <div class="value income">${formatCurrency(income)}</div>
            </div>
            <div class="metric-card">
                <h3>Total Despesas</h3>
                <div class="value expense">${formatCurrency(expense)}</div>
            </div>
        </div>

        <div class="section-title">Despesas por Categoria</div>
        <table>
            <thead>
                <tr>
                    <th>Categoria</th>
                    <th>Total Gasto</th>
                    <th>Proporção (%)</th>
                </tr>
            </thead>
            <tbody>
    `;

    const categoriesList = Object.keys(categorySums);
    if (categoriesList.length === 0) {
        html += `<tr><td colspan="3" style="text-align: center; color: #94a3b8;">Nenhuma despesa registrada neste período.</td></tr>`;
    } else {
        categoriesList.sort((a,b) => categorySums[b] - categorySums[a]);
        categoriesList.forEach(cat => {
            const amt = categorySums[cat];
            const pct = expense > 0 ? ((amt / expense) * 100).toFixed(1) : 0;
            html += `
                <tr>
                    <td><strong>${cat}</strong></td>
                    <td>${formatCurrency(amt)}</td>
                    <td>${pct}%</td>
                </tr>
            `;
        });
    }

    html += `
            </tbody>
        </table>

        <div class="section-title">Detalhamento das Transações</div>
        <table>
            <thead>
                <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Sort transactions: newest first
    filteredTransactions.sort((a,b) => b.date.localeCompare(a.date));
    filteredTransactions.forEach(t => {
        const amtClass = t.type === 'income' ? 'amount-inc' : 'amount-exp';
        const typeLabel = t.type === 'income' ? 'Receita' : 'Despesa';
        const typeClass = t.type === 'income' ? 'inc' : 'exp';
        html += `
            <tr>
                <td>${formatDateBR(t.date)}</td>
                <td><strong>${t.description}</strong></td>
                <td>${t.category}</td>
                <td><span class="type-tag ${typeClass}">${typeLabel}</span></td>
                <td class="${amtClass}">${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>

        <div class="footer">
            Relatório oficial exportado digitalmente em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.
        </div>

        <script>
            window.onload = function() {
                setTimeout(() => {
                    window.print();
                }, 300);
            }
        </script>
    </body>
    </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    showToast('Visualização de impressão do PDF iniciada!', 'success');
}

function handleFileInputChange(e) {
    const file = e.target.files[0];
    const fileNameSpan = document.getElementById('importFileName');
    const importBtn = document.getElementById('confirmImportBtn');

    if (file) {
        fileNameSpan.textContent = file.name;
        importBtn.removeAttribute('disabled');
    } else {
        fileNameSpan.textContent = 'Nenhum arquivo selecionado';
        importBtn.setAttribute('disabled', 'true');
    }
}

function confirmImport() {
    const fileInput = document.getElementById('importFileInput');
    const file = fileInput.files[0];

    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            if (importedData.transactions && importedData.categories) {
                showConfirmModal(
                    'Confirmar Importação de Dados',
                    'A importação irá apagar e substituir TODOS os seus registros atuais do banco de dados por este backup. Tem certeza que deseja continuar?',
                    async () => {
                        try {
                            await deleteItemsByUsername('transactions', state.username);
                            await deleteItemsByUsername('categories', state.username);
                            await deleteItemsByUsername('budgets', state.username);

                            const newCategories = (importedData.categories || []).map((c, i) => ({
                                id: c.id || `cat-${state.username}-${i}-${Date.now()}`,
                                username: state.username,
                                name: c.name,
                                color: c.color,
                                icon: c.icon
                            }));

                            const newTransactions = (importedData.transactions || []).map((t, i) => ({
                                id: t.id || `trans-${state.username}-${i}-${Date.now()}`,
                                username: state.username,
                                description: t.description,
                                amount: t.amount,
                                type: t.type,
                                category: t.category,
                                date: t.date
                            }));

                            const newBudgetsList = [];
                            const newBudgets = {};
                            
                            if (Array.isArray(importedData.budgets)) {
                                importedData.budgets.forEach(b => {
                                    newBudgetsList.push({
                                        id: b.id || `budget-${state.username}-${b.category}`,
                                        username: state.username,
                                        category: b.category,
                                        amount: b.amount
                                    });
                                    newBudgets[b.category] = b.amount;
                                });
                            } else if (typeof importedData.budgets === 'object') {
                                Object.keys(importedData.budgets).forEach(catName => {
                                    const val = importedData.budgets[catName];
                                    newBudgetsList.push({
                                        id: `budget-${state.username}-${catName}`,
                                        username: state.username,
                                        category: catName,
                                        amount: val
                                    });
                                    newBudgets[catName] = val;
                                });
                            }

                            for (let c of newCategories) await putItem('categories', c);
                            for (let t of newTransactions) await putItem('transactions', t);
                            for (let b of newBudgetsList) await putItem('budgets', b);

                            state.transactions = newTransactions;
                            state.categories = newCategories;
                            state.budgets = newBudgets;

                            initializeReferenceMonth();
                            renderApp();
                            closeModal('backupModal');
                            showToast('Importação de dados concluída com sucesso!', 'success');
                            
                            fileInput.value = '';
                            document.getElementById('importFileName').textContent = 'Nenhum arquivo selecionado';
                            document.getElementById('confirmImportBtn').setAttribute('disabled', 'true');
                        } catch (dbErr) {
                            showToast('Erro ao importar dados no banco local.', 'danger');
                        }
                    }
                );
            } else {
                showToast('O arquivo de backup selecionado é inválido.', 'danger');
            }
        } catch (err) {
            showToast('Falha ao ler o arquivo JSON. Certifique-se que o backup seja válido.', 'danger');
        }
    };
    reader.readAsText(file);
}

function clearAllData() {
    showConfirmModal(
        'Limpar Todos os Dados',
        'ATENÇÃO: Isto excluirá permanentemente todos os registros de transações, categorias e limites do banco de dados local para a sua conta. Esta operação não pode ser desfeita. Tem certeza?',
        async () => {
            try {
                await deleteItemsByUsername('transactions', state.username);
                await deleteItemsByUsername('categories', state.username);
                await deleteItemsByUsername('budgets', state.username);

                await loadUserData(state.username);
                initializeReferenceMonth();
                
                renderApp();
                closeModal('backupModal');
                showToast('Sua conta foi limpa e restaurada com as configurações padrão.', 'info');
            } catch (err) {
                console.error("Error clearing user data:", err);
                showToast('Erro ao limpar base de dados.', 'danger');
            }
        }
    );
}

// --- Bind HTML Event Listeners ---
function setupEventListeners() {
    // Theme Switcher button
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Active Month Navigation Trigger buttons
    document.getElementById('prevMonthBtn').addEventListener('click', () => changeReferenceMonth(-1));
    document.getElementById('nextMonthBtn').addEventListener('click', () => changeReferenceMonth(1));

    // Dynamic Export period selector inputs toggle
    document.getElementById('exportPeriodSelect').addEventListener('change', (e) => {
        const val = e.target.value;
        const monthWrapper = document.getElementById('exportMonthWrapper');
        const customWrapper = document.getElementById('exportCustomRangeWrapper');
        
        if (val === 'all') {
            monthWrapper.style.display = 'none';
            customWrapper.style.display = 'none';
        } else if (val === 'month') {
            monthWrapper.style.display = 'block';
            customWrapper.style.display = 'none';
        } else if (val === 'custom') {
            monthWrapper.style.display = 'none';
            customWrapper.style.display = 'block';
        }
    });

    // Auth screen tabs toggles (Login, Register, Recovery)
    document.getElementById('loginTab').addEventListener('click', () => {
        switchAuthTab('loginTab', 'loginForm');
    });

    document.getElementById('registerTab').addEventListener('click', () => {
        switchAuthTab('registerTab', 'registerForm');
    });

    document.getElementById('recoveryTab').addEventListener('click', () => {
        switchAuthTab('recoveryTab', 'recoveryForm');
    });

    // Forgot password auxiliary link
    document.getElementById('forgotPassBtn').addEventListener('click', () => {
        switchAuthTab('recoveryTab', 'recoveryForm');
        
        const typedUser = document.getElementById('loginUser').value.trim();
        if (typedUser) {
            document.getElementById('recoveryUser').value = typedUser;
        }
    });

    // Login Form Submit handler
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('loginUser').value.trim().toLowerCase();
        const passwordInput = document.getElementById('loginPass').value;
        const loginError = document.getElementById('loginError');

        loginError.style.display = 'none';

        if (!usernameInput || !passwordInput) return;

        try {
            const isValid = await validateLogin(usernameInput, passwordInput);
            if (isValid) {
                await loginUserSession(usernameInput);
            } else {
                loginError.style.display = 'block';
                showToast('Login inválido! Verifique suas credenciais.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('Erro ao efetuar tentativa de login.', 'danger');
        }
    });

    // Register Form Submit handler
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('registerUser').value.trim().toLowerCase();
        const passwordInput = document.getElementById('registerPass').value;
        const confirmInput = document.getElementById('registerPassConfirm').value;
        const questionInput = document.getElementById('registerQuestion').value;
        const answerInput = document.getElementById('registerAnswer').value;

        const userError = document.getElementById('registerUserError');
        const passError = document.getElementById('registerPassError');

        userError.style.display = 'none';
        passError.style.display = 'none';

        if (!usernameInput || !passwordInput || !confirmInput || !questionInput || !answerInput) {
            showToast('Preencha todos os campos do formulário.', 'warning');
            return;
        }

        if (passwordInput.length < 4) {
            showToast('A senha deve conter no mínimo 4 caracteres.', 'warning');
            return;
        }

        if (passwordInput !== confirmInput) {
            passError.style.display = 'block';
            return;
        }

        try {
            await registerUser(usernameInput, passwordInput, questionInput, answerInput);
            showToast('Conta criada com sucesso! Faça seu login para acessar.', 'success');
            
            switchAuthTab('loginTab', 'loginForm');
            document.getElementById('loginUser').value = usernameInput;
            document.getElementById('loginPass').value = '';
            document.getElementById('loginPass').focus();
        } catch (err) {
            if (err === 'username_exists') {
                userError.style.display = 'block';
                showToast('Este nome de usuário já está sendo utilizado.', 'warning');
            } else {
                console.error(err);
                showToast('Erro ao registrar nova conta.', 'danger');
            }
        }
    });

    // Recovery Form Submit handler
    document.getElementById('recoveryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('recoveryUser').value.trim().toLowerCase();
        const questionInput = document.getElementById('recoveryQuestion').value;
        const answerInput = document.getElementById('recoveryAnswer').value;
        const newPassInput = document.getElementById('recoveryPass').value;
        const confirmPassInput = document.getElementById('recoveryPassConfirm').value;

        const userError = document.getElementById('recoveryUserError');
        const answerError = document.getElementById('recoveryAnswerError');
        const passError = document.getElementById('recoveryPassError');

        userError.style.display = 'none';
        answerError.style.display = 'none';
        passError.style.display = 'none';

        if (!usernameInput || !questionInput || !answerInput || !newPassInput || !confirmPassInput) {
            showToast('Preencha todos os campos de redefinição.', 'warning');
            return;
        }

        if (newPassInput.length < 4) {
            showToast('A nova senha deve possuir no mínimo 4 caracteres.', 'warning');
            return;
        }

        if (newPassInput !== confirmPassInput) {
            passError.style.display = 'block';
            return;
        }

        try {
            const status = await validateRecovery(usernameInput, questionInput, answerInput);
            
            if (status === 'user_not_found') {
                userError.style.display = 'block';
                showToast('Este nome de usuário não está cadastrado.', 'warning');
                return;
            }
            if (status === 'invalid_credentials') {
                answerError.style.display = 'block';
                showToast('Resposta de segurança inválida!', 'danger');
                return;
            }

            await resetPassword(usernameInput, newPassInput);
            showToast('Sua senha foi atualizada! Faça o login com a nova credencial.', 'success');
            
            switchAuthTab('loginTab', 'loginForm');
            document.getElementById('loginUser').value = usernameInput;
            document.getElementById('loginPass').value = '';
            document.getElementById('loginPass').focus();
        } catch (err) {
            console.error(err);
            showToast('Erro durante o processamento da redefinição.', 'danger');
        }
    });

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logoutUserSession);

    // Custom Confirm Modal button handlers
    document.getElementById('confirmModalConfirmBtn').addEventListener('click', () => handleConfirmModalAction(true));
    document.getElementById('confirmModalCancelBtn').addEventListener('click', () => handleConfirmAction(false));
    
    // Fallback confirmation handler binding
    function handleConfirmAction(val) {
        handleConfirmModalAction(val);
    }
    document.getElementById('closeConfirmModalBtn').addEventListener('click', () => handleConfirmAction(false));

    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') {
            handleConfirmAction(false);
        }
    });

    // Modal Add Transaction Openers
    document.getElementById('openAddTransactionBtn').addEventListener('click', () => {
        document.getElementById('modalTitle').textContent = 'Nova Transação';
        document.getElementById('transactionId').value = '';
        document.getElementById('transactionForm').reset();
        
        const todayStr = new Date().toISOString().substring(0, 10);
        document.getElementById('transDate').value = todayStr;
        
        clearErrors();
        openModal('transactionModal');
    });

    // Modals Openers
    document.getElementById('openCategoriesBtn').addEventListener('click', () => openModal('categoriesModal'));
    document.getElementById('openBudgetsBtn').addEventListener('click', () => openModal('budgetsModal'));
    
    // Open backup modal and reset selector states
    document.getElementById('openBackupBtn').addEventListener('click', () => {
        document.getElementById('exportPeriodSelect').value = 'all';
        document.getElementById('exportMonthWrapper').style.display = 'none';
        document.getElementById('exportCustomRangeWrapper').style.display = 'none';
        document.getElementById('exportFormatSelect').value = 'json';
        
        const today = new Date();
        const y = today.getFullYear();
        const mo = String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('exportMonthInput').value = `${y}-${mo}`;
        
        openModal('backupModal');
    });

    // Modals Closers
    document.getElementById('closeTransactionModalBtn').addEventListener('click', () => closeModal('transactionModal'));
    document.getElementById('cancelTransactionBtn').addEventListener('click', () => closeModal('transactionModal'));
    
    document.getElementById('closeCategoriesModalBtn').addEventListener('click', () => closeModal('categoriesModal'));
    document.getElementById('closeBudgetsModalBtn').addEventListener('click', () => closeModal('budgetsModal'));
    document.getElementById('closeBackupModalBtn').addEventListener('click', () => closeModal('backupModal'));

    // Form Submissions
    document.getElementById('transactionForm').addEventListener('submit', handleTransactionFormSubmit);
    document.getElementById('categoryForm').addEventListener('submit', handleCategoryFormSubmit);
    document.getElementById('budgetForm').addEventListener('submit', handleBudgetFormSubmit);

    // Filter Controls Listeners
    document.getElementById('searchInput').addEventListener('input', renderTransactionsTable);
    document.getElementById('filterType').addEventListener('change', renderTransactionsTable);
    document.getElementById('filterCategory').addEventListener('change', renderTransactionsTable);
    document.getElementById('filterStartDate').addEventListener('input', renderTransactionsTable);
    document.getElementById('filterEndDate').addEventListener('input', renderTransactionsTable);

    // Clear Filters Button
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        document.getElementById('filterType').value = 'all';
        document.getElementById('filterCategory').value = 'all';
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        renderTransactionsTable();
    });

    // Sorting Headers Click listeners
    document.querySelectorAll('.transactions-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (state.sort.field === field) {
                state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.sort.field = field;
                state.sort.direction = 'asc';
            }
            
            document.querySelectorAll('.transactions-table th.sortable i').forEach(icon => {
                icon.className = 'fa-solid fa-sort';
            });
            const currentIcon = th.querySelector('i');
            if (currentIcon) {
                currentIcon.className = `fa-solid fa-sort-${state.sort.direction === 'asc' ? 'up' : 'down'}`;
            }

            renderTransactionsTable();
        });
    });

    // Backup actions bindings
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importFileInput').addEventListener('change', handleFileInputChange);
    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
    document.getElementById('clearAllDataBtn').addEventListener('click', clearAllData);
}

// Switching logic helper for auth screens tabs
function switchAuthTab(activeTabId, activeFormId) {
    document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    
    document.getElementById(activeTabId).classList.add('active');
    document.getElementById(activeFormId).classList.add('active');
}

// Make helper delete triggers globally accessible (for inline table button calls)
window.deleteCategory = deleteCategory;
window.deleteBudget = deleteBudget;
window.deleteTransaction = deleteTransaction;
window.openEditTransactionModal = openEditTransactionModal;
window.closeModal = closeModal;
window.togglePasswordVisibility = togglePasswordVisibility;
window.deleteItemGlobal = deleteItemGlobal;
