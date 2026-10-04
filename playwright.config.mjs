import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/ui',fullyParallel:false,workers:1,retries:0,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:8787',browserName:'chromium',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node scripts/dev.mjs',url:'http://127.0.0.1:8787/api/health',reuseExistingServer:false,timeout:30000,env:{DEMO_DB:':memory:'}}
});
