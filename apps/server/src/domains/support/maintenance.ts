import type { AppDatabase,SqlExecutor } from '../../db/client.js'
import type { ClickUpServices } from '../../modules/clickup/service.js'
import { assertClickUpTaskId } from '../../modules/clickup/errors.js'
import { FeedbackError } from './errors.js'
import { readRecord,markUnknown,clearAttempt,clearFailure,type RecordSet } from './records.js'
import { matchesTask } from './metadata.js'
import { sha256 } from './validation.js'
export interface NotWrittenEvidence { evidenceKind:'explicit_rejection'|'provider_confirmation'; providerReference:string; observedAt:number; confirmedNotExecuted:true }
export interface MaintenanceDependencies {db:AppDatabase;clickup:ClickUpServices;now?:()=>number;secrets?:readonly string[]}
export function validateEvidence(value:unknown,secrets:readonly string[]=[]):NotWrittenEvidence {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new FeedbackError('FEEDBACK_INVALID_INPUT')
  const v=value as Record<string,unknown>,serialized=JSON.stringify(value)
  if(Buffer.byteLength(serialized)>4096 || Object.keys(v).sort().join(',')!=='confirmedNotExecuted,evidenceKind,observedAt,providerReference' || !['explicit_rejection','provider_confirmation'].includes(v.evidenceKind as string) || v.confirmedNotExecuted!==true || typeof v.providerReference!=='string'||!v.providerReference||v.providerReference.length>256||/[\x00-\x1f\x7f]/.test(v.providerReference)||typeof v.observedAt!=='number'||!Number.isSafeInteger(v.observedAt)||v.observedAt<0||secrets.some(secret=>secret && (serialized.includes(secret)||(v.providerReference as string).includes(secret)||serialized.includes(encodeURIComponent(secret)))))throw new FeedbackError('FEEDBACK_INVALID_INPUT')
  return v as unknown as NotWrittenEvidence
}
export function createSupportMaintenance({db,clickup,now=Date.now,secrets=[]}:MaintenanceDependencies) {
  const local=async(id:string)=>db.transaction(tx=>readRecord(tx,id), 'repeatable-read-read-only')
  const verifyTask=async(r:RecordSet,id:string)=>{
    assertClickUpTaskId(id)
    if(r.row.clickup_task_id!==null&&r.row.clickup_task_id!==id)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
    const remote=await clickup.getTask(id)
    if(!matchesTask(remote,r.taskPayload,id))throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
    return remote
  }
  async function pending(tx:SqlExecutor,id:string,attempt:string,revision?:number):Promise<RecordSet> {
    let r=await readRecord(tx,id,undefined,true)
    if(r.row.attempt_id!==attempt || (revision!==undefined&&r.row.revision!==revision))throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
    if(r.row.status!=='verification_required') {
      if(r.row.attempt_expires_at===null||r.row.attempt_expires_at>now())throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      await markUnknown(tx,r,now());r=await readRecord(tx,id)
    }
    return r
  }
  // Convert expired attempts in their own durable transaction before remote reads.
  const start=async(id:string,attempt:string)=>db.transaction(tx=>pending(tx,id,attempt))
  return {
    async inspect(id:string,remoteTaskId?:string) {
      const r=await local(id),s=r.row
      const remote=remoteTaskId ? await verifyTask(r,remoteTaskId):undefined
      return {id:s.id,revision:s.revision,status:s.status,createdAt:s.created_at,receiveExpiresAt:s.receive_expires_at,taskId:s.clickup_task_id,attempt:s.attempt_id===null?null:{id:s.attempt_id,kind:s.attempt_kind,attachmentId:s.attempt_attachment_id,startedAt:s.attempt_started_at,expiresAt:s.attempt_expires_at,ownerBootId:s.attempt_owner_boot_id},failure:s.failure_code,attachments:r.attachments.map(a=>({id:a.id,ordinal:a.ordinal,byteLength:a.byte_length,sha256:a.sha256,status:a.status,remoteAttachmentId:a.remote_attachment_id})),remote:remote?{taskId:remote.id,verified:true,attachments:remote.attachments.map(a=>({id:a.id,title:a.title??null,size:a.size??null}))}:null}
    },
    async resolveTask(id:string,attempt:string,remoteTaskId:string,confirm:boolean) {
      if(!confirm)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      const initial=await start(id,attempt)
      if(initial.row.attempt_kind!=='create_task')throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      await verifyTask(initial,remoteTaskId)
      await db.transaction(async tx=>{
        const r=await pending(tx,id,attempt,initial.row.revision)
        if(r.row.attempt_kind!=='create_task'||(r.row.clickup_task_id!==null&&r.row.clickup_task_id!==remoteTaskId))throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
        await tx.query(`UPDATE support_feedback_submissions SET clickup_task_id=$2,status=$3,${clearAttempt},${clearFailure},maintenance_resolution_json=$4,revision=revision+1,updated_at=$5 WHERE id=$1`,[id,remoteTaskId,r.attachments.length?'uploading':'completed',JSON.stringify({action:'resolve_task',attemptId:attempt,taskId:remoteTaskId,resolvedAt:now()}),now()])
      })
      return this.inspect(id)
    },
    async resolveAttachment(id:string,attachmentId:string,attempt:string,remoteAttachmentId:string,downloaded:Uint8Array,confirm:boolean) {
      if(!confirm || !remoteAttachmentId || remoteAttachmentId.length>256 || /[\x00-\x1f\x7f]/.test(remoteAttachmentId))throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      const initial=await start(id,attempt)
      const a=initial.attachments.find(a=>a.id===attachmentId)
      if(!a||initial.row.attempt_kind!=='upload_attachment'||initial.row.attempt_attachment_id!==attachmentId||!initial.row.clickup_task_id||downloaded.byteLength!==a.byte_length||sha256(downloaded)!==a.sha256)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      const remote=await verifyTask(initial,initial.row.clickup_task_id)
      if(remote.attachments.filter(a=>a.id===remoteAttachmentId).length!==1)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      await db.transaction(async tx=>{
        const r=await pending(tx,id,attempt,initial.row.revision)
        if(r.row.attempt_attachment_id!==attachmentId || r.row.clickup_task_id!==initial.row.clickup_task_id)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
        await tx.query("UPDATE support_feedback_attachments SET status='uploaded',remote_attachment_id=$3,bytes=NULL,updated_at=$4 WHERE submission_id=$1 AND id=$2",[id,attachmentId,remoteAttachmentId,now()])
        const done=r.attachments.every(a=>a.id===attachmentId||a.status==='uploaded')
        await tx.query(`UPDATE support_feedback_submissions SET status=$2,${clearAttempt},${clearFailure},maintenance_resolution_json=$3,revision=revision+1,updated_at=$4 WHERE id=$1`,[id,done?'completed':'uploading',JSON.stringify({action:'resolve_attachment',attemptId:attempt,attachmentId,remoteAttachmentId,resolvedAt:now()}),now()])
      })
      return this.inspect(id)
    },
    async confirmNotWritten(id:string,attempt:string,value:unknown,confirm:boolean) {
      if(!confirm)throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
      const evidence=validateEvidence(value,secrets)
      if(evidence.observedAt>now())throw new FeedbackError('FEEDBACK_INVALID_INPUT')
      const initial=await start(id,attempt)
      await db.transaction(async tx=>{
        const r=await pending(tx,id,attempt,initial.row.revision)
        if((r.row.attempt_kind==='create_task'&&r.row.clickup_task_id)||r.attachments.some(a=>a.id===r.row.attempt_attachment_id&&a.remote_attachment_id))throw new FeedbackError('FEEDBACK_STATE_CONFLICT')
        if(r.row.attempt_attachment_id)await tx.query("UPDATE support_feedback_attachments SET status='failed',updated_at=$3 WHERE submission_id=$1 AND id=$2",[id,r.row.attempt_attachment_id,now()])
        await tx.query(`UPDATE support_feedback_submissions SET status='failed',failure_code='UPSTREAM_REJECTED',failure_phase=attempt_kind,failure_attachment_id=attempt_attachment_id,retry_not_before=NULL,${clearAttempt},maintenance_resolution_json=$2,revision=revision+1,updated_at=$3 WHERE id=$1`,[id,JSON.stringify({action:'confirm_not_written',attemptId:attempt,evidence,resolvedAt:now()}),now()])
      })
      return this.inspect(id)
    },
    async cleanupExpired(before:number,apply=false,confirm=false) {
      if(!Number.isSafeInteger(before)||before<0||before>now()|| (apply&&!confirm))throw new FeedbackError('FEEDBACK_INVALID_INPUT')
      return db.transaction(async tx=>{
        const rows=await tx.query<{id:string;revision:string|number}>(`SELECT id,revision FROM support_feedback_submissions WHERE status='receiving' AND receive_expires_at<=$1 AND clickup_task_id IS NULL AND attempt_id IS NULL ORDER BY id${apply?' FOR UPDATE':''}`,[before])
        if(apply)for(const r of rows.rows) {
          // Parent locks serialize against concurrent upload/claim. No unrelated status is eligible.
          await readRecord(tx,r.id)
          await tx.query('DELETE FROM support_feedback_attachments WHERE submission_id=$1',[r.id])
          await tx.query("DELETE FROM support_feedback_submissions WHERE id=$1 AND status='receiving' AND attempt_id IS NULL AND clickup_task_id IS NULL AND receive_expires_at<=$2",[r.id,before])
        }
        return {applied:apply,submissionIds:rows.rows.map(r=>r.id)}
      })
    },
  }
}
