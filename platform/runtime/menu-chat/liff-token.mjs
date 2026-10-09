// Same verification sequence as the SaaS, with expiry and UID validation.
export async function verifyLiffAccessToken(token,clientId,fetcher=fetch){
 const r=await fetcher('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:token})});
 if(!r.ok)throw Error('LIFF_TOKEN_INVALID');const d=await r.json();if(String(d.client_id)!==clientId||!String(d.scope).split(/\s+/).includes('profile')||!Number.isFinite(d.expires_in)||d.expires_in<=0)throw Error('LIFF_TOKEN_INVALID');
 const profile=await fetcher('https://api.line.me/v2/profile',{headers:{Authorization:'Bearer '+token}});if(!profile.ok)throw Error('LIFF_TOKEN_INVALID');const person=await profile.json();if(!/^U[a-f0-9]{32}$/.test(person.userId||''))throw Error('LIFF_TOKEN_INVALID');return{lineUserId:person.userId,clientId};
}
