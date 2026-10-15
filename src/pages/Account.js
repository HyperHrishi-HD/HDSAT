import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Select, Toggle } from '../components/ui';
import { useApp } from '../lib/store';
export function AccountPage() {
    const app = useApp();
    const [authMode, setAuthMode] = useState('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [busy, setBusy] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);
    const [formError, setFormError] = useState(null);
    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormError(null);
        setStatusMessage(null);
        if (!email.trim() || !password) {
            setFormError('Please enter both your email address and password.');
            return;
        }
        setBusy(true);
        try {
            if (authMode === 'signin') {
                await app.actions.signIn(email.trim(), password);
                setStatusMessage('Signed in to your HDSAT cloud account.');
            }
            else {
                const msg = await app.actions.signUp(email.trim(), password, displayName.trim() || 'Student');
                setStatusMessage(msg);
            }
            setPassword('');
        }
        catch (err) {
            setFormError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { children: [_jsx(Card, { children: _jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "Account, Cloud Sync & Preferences" }), _jsx("p", { className: "muted", children: "Sign in with email and password to synchronize your question history, streaks, flashcards, and HDCoins across devices, or continue in local guest mode." })] }), _jsx(Badge, { tone: app.mode === 'cloud' ? 'good' : 'warn', children: app.mode === 'cloud' ? 'Cloud Synchronized' : 'Local Guest Mode' })] }) }), statusMessage ? _jsx(Alert, { tone: "notice", children: statusMessage }) : null, formError ? _jsx(Alert, { tone: "error", children: formError }) : null, app.syncMessage ? _jsx(Alert, { tone: "info", children: app.syncMessage }) : null, _jsxs("div", { className: "grid-2", children: [_jsx(Card, { children: app.user ? (_jsxs("div", { className: "stack", children: [_jsx("h2", { children: "Signed-In Profile" }), _jsxs("div", { className: "muted-block", children: [_jsxs("div", { children: [_jsx("strong", { children: "Display Name:" }), " ", app.user.displayName] }), _jsxs("div", { children: [_jsx("strong", { children: "Email:" }), " ", app.user.email] }), _jsxs("div", { children: [_jsx("strong", { children: "User ID:" }), " ", _jsx("code", { children: app.user.id })] })] }), _jsxs("div", { className: "stack", style: { marginTop: 8 }, children: [_jsx("h3", { children: "Merge Browser Guest Progress" }), _jsx("p", { className: "muted", children: "Replays any local guest attempts, saved questions, and flashcard reviews into your cloud account using idempotent event keys so nothing is double-counted." }), _jsxs("div", { className: "row", children: [_jsx(Button, { onClick: app.actions.syncGuestData, disabled: app.syncing, children: app.syncing ? 'Syncing guest history...' : 'Sync Guest History to Cloud' }), _jsx(Button, { variant: "outline", onClick: app.actions.signOut, children: "Sign Out" })] })] })] })) : (_jsxs("div", { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 12 }, children: [_jsx("h2", { children: authMode === 'signin' ? 'Sign In to HDSAT' : 'Create an HDSAT Account' }), _jsxs("div", { className: "row", children: [_jsx(Button, { size: "sm", variant: authMode === 'signin' ? 'primary' : 'outline', onClick: () => setAuthMode('signin'), children: "Sign in" }), _jsx(Button, { size: "sm", variant: authMode === 'signup' ? 'primary' : 'outline', onClick: () => setAuthMode('signup'), children: "Create account" })] })] }), !app.cloudConfigured ? (_jsx("div", { className: "muted-block", children: _jsxs("p", { style: { margin: 0 }, children: [_jsx("strong", { children: "Cloud authentication is not configured in this build." }), " Set", ' ', _jsx("code", { children: "VITE_SUPABASE_URL" }), " and ", _jsx("code", { children: "VITE_SUPABASE_ANON_KEY" }), " in your environment to enable Supabase email-and-password sign-in. You can use every practice, test, flashcard, and reward feature right now in local Guest Mode."] }) })) : (_jsxs("form", { onSubmit: handleSubmit, children: [authMode === 'signup' ? (_jsx(Field, { label: "Display Name", children: _jsx("input", { type: "text", value: displayName, onChange: (e) => setDisplayName(e.target.value), placeholder: "e.g. Hrishi" }) })) : null, _jsx(Field, { label: "Email Address", children: _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", required: true }) }), _jsx(Field, { label: "Password", hint: "Minimum 6 characters", children: _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true }) }), _jsxs("div", { className: "row", children: [_jsx(Button, { type: "submit", disabled: busy, children: busy ? 'Working...' : authMode === 'signin' ? 'Sign In' : 'Create Account' }), _jsx(Button, { type: "button", variant: "outline", onClick: app.actions.continueAsGuest, children: "Continue in Guest Mode" })] })] }))] })) }), _jsxs(Card, { children: [_jsx("h2", { children: "Study Preferences & Local Storage" }), _jsx(Select, { label: "Default Assessment", value: app.settings.assessment, onChange: (v) => app.actions.updateSettings({ assessment: v }), options: [
                                    { value: 'SAT', label: 'Digital SAT' },
                                    { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                                    { value: 'PSAT 10', label: 'PSAT 10' },
                                    { value: 'PSAT 8/9', label: 'PSAT 8/9' },
                                ] }), _jsx(Toggle, { checked: app.settings.excludePreviouslyCorrect, onChange: (val) => app.actions.updateSettings({ excludePreviouslyCorrect: val }), label: "Exclude previously correct items by default", hint: "Applies to new Custom Practice sessions." }), _jsx(Toggle, { checked: app.settings.excludeReleasedPracticeSet, onChange: (val) => app.actions.updateSettings({ excludeReleasedPracticeSet: val }), label: "Reserve Benchmark Simulation Set items", hint: "Prevents benchmark simulation questions from appearing in general drills." }), _jsxs("div", { className: "muted-block", style: { marginTop: 14 }, children: [_jsx("h3", { children: "Local Guest Data" }), _jsxs("p", { className: "muted", children: ["Your browser stores guest progress under ", _jsx("code", { children: "hdsat.profile.v1" }), " so refreshing the page preserves your attempts, saved items, and streak."] }), _jsx(Button, { variant: "danger", size: "sm", onClick: app.actions.resetGuestProgress, children: "Reset Local Guest Progress" })] })] })] })] }));
}
