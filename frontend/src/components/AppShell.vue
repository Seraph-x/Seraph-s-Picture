<template>
  <div class="app-bg">
    <header class="topbar card">
      <div class="brand-group">
        <span class="brand-dot"></span>
        <div>
          <h1>Seraph's Pictures</h1>
          <p>{{ t('shell.tagline') }}</p>
        </div>
      </div>
      <nav class="nav-row">
        <router-link class="nav-link" to="/">{{ t('nav.upload') }}</router-link>
        <router-link class="nav-link" to="/drive">{{ t('nav.drive') }}</router-link>
        <router-link class="nav-link" to="/storage">{{ t('nav.storage') }}</router-link>
        <router-link class="nav-link" to="/status">{{ t('nav.status') }}</router-link>
        <a class="nav-link" href="/">{{ t('nav.legacy') }}</a>
      </nav>
      <div class="toolbar">
        <button class="btn btn-ghost" type="button" @click="toggleLocale">{{ nextLabel }}</button>
        <router-link
          v-if="authStore.authRequired && !authStore.authenticated"
          class="btn btn-ghost"
          to="/login"
        >
          {{ t('shell.login') }}
        </router-link>
        <button v-if="authStore.authenticated" class="btn btn-ghost" @click="handleLogout">{{ t('shell.logout') }}</button>
      </div>
    </header>

    <section v-if="authStore.guestMode" class="guest-note card">
      <strong>{{ t('shell.guestEnabled') }}</strong>
      <span>
        {{ t('shell.guestInfo', { size: formatSize(authStore.guestUpload.maxFileSize), limit: authStore.guestUpload.dailyLimit }) }}
      </span>
    </section>

    <main class="page-wrap">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useI18n } from '../i18n';

const authStore = useAuthStore();
const router = useRouter();
const { t, toggleLocale, nextLabel } = useI18n();

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

async function handleLogout() {
  try {
    await authStore.logout();
  } finally {
    router.push('/login');
  }
}
</script>
