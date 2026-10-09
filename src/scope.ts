import type {Env} from './types.js';
import {fail} from './shared.js';

// Future commercial flows are retained only for an explicitly selected local regression preview.
// This flag cannot enable digital sales in production, staging or the protected simulation Worker.
export const digitalPreview=(env:Env)=>env.APP_ENV==='local'&&env.DIGITAL_PREVIEW==='on';
export function requireDigitalPreview(env:Env){
 if(!digitalPreview(env))fail(409,'第一期僅提供借址服務；數位服務及分潤標準待議定，尚未開放收費或開通');
}
