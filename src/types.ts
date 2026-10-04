export interface Result { results: Record<string, unknown>[]; meta: { changes: number }; }
export interface Statement {
 bind(...values: unknown[]): Statement;
 first<T = Record<string, unknown>>(): Promise<T | null>;
 all<T = Record<string, unknown>>(): Promise<{results:T[]}>;
 run(): Promise<Result>;
}
export interface Database { prepare(sql: string): Statement; batch(statements:Statement[]):Promise<Result[]>; }
export interface Env { DB:Database; APP_ENV?:string; DEMO_MODE?:string; ASSETS?:{fetch(request:Request):Promise<Response>}; }
export type Role = 'operator_owner'|'operator_sales'|'operator_service'|'operator_finance'|'platform_admin'|'business_admin';
export interface Actor { id:string; operator_id:string; name:string; role:Role; active:number; }
export interface Opportunity {
 id:string; operator_id:string; business_id:string; title:string; stage:string;
 owner_id:string; amount:number; payment_status:string; next_action:string; followup_at:string;
 note:string; version:number; created_at:string; updated_at:string;
}
