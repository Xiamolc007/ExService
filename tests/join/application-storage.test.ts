import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { approvedInvitation, createTestAuth, experiencedJoinApplication, joinSnapshot, newJoinApplication, registerInvited } from '../helpers/auth'
import { normalizeJoinApplicationPayload } from '../../apps/mock-server/src/join/form-validation'
import { MAX_PROOF_BYTES, validateJoinProofs } from '../../apps/mock-server/src/join/attachment-validation'
const fixtures: Array<ReturnType<typeof createTestAuth>> = []
afterEach(() => { vi.restoreAllMocks(); fixtures.splice(0).forEach(f => f.close()) })
function setup() { const f = createTestAuth(); fixtures.push(f); return f }
const code = (value: string) => expect.objectContaining({ code: value })
const proof = (originalName = 'proof.txt', bytes = Buffer.from('证明材料')) => ({ originalName, bytes })
const rows = (f: ReturnType<typeof createTestAuth>) => f.sqlite.prepare('SELECT id FROM join_applications ORDER BY created_at DESC, id DESC').all() as Array<{ id: string }>

it('persists both complete categories, normalized declared text and exact optional attachment bytes', () => {
  const f = setup(), input = experiencedJoinApplication('  EXPERIENCED@EXAMPLE.COM  ')
  input.nickname = '  😀  '; input.form.freeTime = '  周末  '; input.form.answers.leaveReason = '  自由填写\n第二行  '
  const files = [proof('证明.PDF', Buffer.from('%PDF-1.7\ncontent')), proof()]
  expect(f.joinServices.submit(input, files)).toEqual({ status: 'received' })
  const id = rows(f)[0]!.id, result = f.joinServices.get(id)
  expect(result).toMatchObject({ formVersion: 1, application: { applicationType: 'experienced', email: 'experienced@example.com', nickname: '😀' }, form: { freeTime: '周末', answers: { leaveReason: '自由填写\n第二行' } } })
  expect(result.attachments).toHaveLength(2)
  for (const [ordinal, metadata] of result.attachments.entries()) {
    const file = files[ordinal]!
    expect(metadata).toMatchObject({ originalName: file.originalName, ordinal, byteLength: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') })
    expect(Object.keys(metadata).sort()).toEqual(['byteLength','extension','id','ordinal','originalName','sha256'])
    expect(f.joinServices.download(id, metadata.id).bytes).toEqual(file.bytes)
  }
  f.joinServices.submit(newJoinApplication('new@example.com'))
  expect(f.joinServices.get(rows(f)[0]!.id)).toMatchObject({ formVersion: 1, application: { applicationType: 'new' }, attachments: [], form: { commitments: { informationAccurate: true, obeyCommunityRules: true, acceptAcademyAttendanceConsequences: true } } })
})

it.each(['join_applications','join_application_email_registry','join_application_forms','join_application_attachments'])('rolls back every table when %s insertion fails', table => {
  const f = setup(), before = joinSnapshot(f)
  f.sqlite.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END`)
  expect(() => f.joinServices.submit(experiencedJoinApplication(), [proof()])).toThrow('injected storage failure')
  expect(joinSnapshot(f)).toEqual(before)
  f.sqlite.exec('DROP TRIGGER fail_insert')
  expect(f.joinServices.submit(experiencedJoinApplication(), [proof()])).toEqual({ status: 'received' })
})
it('rolls back a failure after an earlier attachment was inserted', () => {
  const f = setup(), before = joinSnapshot(f)
  f.sqlite.exec("CREATE TRIGGER fail_second BEFORE INSERT ON join_application_attachments WHEN NEW.ordinal = 1 BEGIN SELECT RAISE(ABORT, 'second attachment failed'); END")
  expect(() => f.joinServices.submit(experiencedJoinApplication(), [proof(), proof('second.txt')])).toThrow('second attachment failed')
  expect(joinSnapshot(f)).toEqual(before)
})
it('keeps unexpected uniqueness failures internal rather than reporting an email duplicate', () => {
  const f = setup()
  f.sqlite.exec("CREATE TRIGGER force_duplicate BEFORE INSERT ON join_application_forms BEGIN INSERT INTO join_application_forms VALUES (NEW.application_id, 1, NEW.application_type, NEW.form_json); END")
  expect(() => f.joinServices.submit(newJoinApplication())).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' }))
  expect(rows(f)).toEqual([])
})
it('preserves rejection/registration lifetime occupancy, prioritizes application history and has a registry fallback', async () => {
  const f = setup(); f.joinServices.submit(newJoinApplication()); const id = rows(f)[0]!.id
  f.joinServices.reject(id); await f.seedUser({ email: 'member@example.com', nickname: 'Existing', password: 'valid password' })
  f.sqlite.prepare('DELETE FROM join_application_email_registry WHERE email = ?').run('member@example.com')
  const before = joinSnapshot(f)
  expect(() => f.joinServices.submit(experiencedJoinApplication(' MEMBER@EXAMPLE.COM '), [proof()])).toThrow(code('JOIN_APPLICATION_EXISTS'))
  expect(joinSnapshot(f)).toEqual(before)
  await registerInvited(f, 'registered@example.com'); const after = joinSnapshot(f)
  expect(() => f.joinServices.submit(newJoinApplication('registered@example.com'))).toThrow(code('JOIN_APPLICATION_EXISTS'))
  expect(joinSnapshot(f)).toEqual(after)
})
it('does not clean stale invitation or delivery state when submitting', async () => {
  const f = setup(); await approvedInvitation(f, 'old@example.com'); f.advance(7 * 86_400_000)
  f.sqlite.exec("UPDATE join_delivery_attempts SET status='pending', finished_at=NULL")
  const invitation = f.sqlite.prepare('SELECT * FROM join_invitations').all(), delivery = f.sqlite.prepare('SELECT * FROM join_delivery_attempts').all()
  f.joinServices.submit(newJoinApplication('new@example.com'))
  expect(f.sqlite.prepare('SELECT * FROM join_invitations').all()).toEqual(invitation)
  expect(f.sqlite.prepare('SELECT * FROM join_delivery_attempts').all()).toEqual(delivery)
})

it.each([
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, unknown: true }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, unknown: true } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, answers: { ...v.form.answers, previousServer: 'wrong category' } } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, commitments: { ...v.form.commitments, informationAccurate: false } } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, discoveryChannels: ['friends','friends'] } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, freeTime: '  ' } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, birthDate: '2001-02-29' } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, form: { ...v.form, birthDate: '2099-01-01' } }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, nickname: '\u0000hidden' }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, email: 'invalid' }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, qq: '1234' }),
  (v: ReturnType<typeof newJoinApplication>) => ({ ...v, qq: '12345678901234' }),
  () => ({ email: 'member@example.com', nickname: 'Old request', qq: '001234' }),
])('independently rejects invalid Contract form input %# without any writes', invalid => {
  const f = setup(), before = joinSnapshot(f)
  expect(() => f.joinServices.submit(invalid(newJoinApplication()))).toThrow(code('BAD_REQUEST'))
  expect(joinSnapshot(f)).toEqual(before)
})
it('normalizes only declared strings and retains unknown fields and QQ for rejection', () => {
  const input = { ...newJoinApplication('  MEMBER@EXAMPLE.COM  ', '  Name  ', '00000'), extra: '  unchanged  ' }
  const normalized = normalizeJoinApplicationPayload(input)
  expect(normalized).toMatchObject({ email: 'member@example.com', nickname: 'Name', qq: '00000', extra: '  unchanged  ' })
  expect(input.email).toBe('  MEMBER@EXAMPLE.COM  ')
})
it('counts Unicode codepoints at essay and nickname boundaries and validates real dates against UTC today', () => {
  const f = setup(), input = experiencedJoinApplication()
  input.form.answers.deescalationEssay = '😀'.repeat(149)
  expect(() => f.joinServices.submit(input)).toThrow(code('BAD_REQUEST'))
  input.form.answers.deescalationEssay = '😀'.repeat(150); input.form.answers.discretionEssay = '😀'.repeat(4000); input.nickname = '😀'.repeat(32)
  input.form.birthDate = new Date(f.now()).toISOString().slice(0,10)
  expect(f.joinServices.submit(input)).toEqual({ status: 'received' })
  const overflow = experiencedJoinApplication('overflow@example.com'); overflow.form.answers.discretionEssay = '😀'.repeat(4001)
  expect(() => f.joinServices.submit(overflow)).toThrow(code('BAD_REQUEST'))
  const name = newJoinApplication('nickname@example.com','😀'.repeat(33)); expect(() => f.joinServices.submit(name)).toThrow(code('BAD_REQUEST'))
})

it.each([
  ['png', Buffer.from([137,80,78,71,13,10,26,10])], ['jpg',Buffer.from([255,216,255])], ['jpeg',Buffer.from([255,216,255])],
  ['gif',Buffer.from('GIF89a')], ['bmp',Buffer.from('BM')], ['pdf',Buffer.from('%PDF-')],
  ['doc',Buffer.from([208,207,17,224,161,177,26,225])], ['xls',Buffer.from([208,207,17,224,161,177,26,225])], ['ppt',Buffer.from([208,207,17,224,161,177,26,225])],
  ['docx',Buffer.from([80,75,3,4])], ['xlsx',Buffer.from([80,75,5,6])], ['pptx',Buffer.from([80,75,7,8])], ['zip',Buffer.from([80,75,3,4])],
  ['rar',Buffer.from([82,97,114,33,26,7,0])], ['7z',Buffer.from([55,122,188,175,39,28])],
  ['txt',Buffer.from('合法UTF-8')], ['svg',Buffer.from('\uFEFF <?xml version="1.0"?><!--root--><svg xmlns="http://www.w3.org/2000/svg"></svg>')],
])('accepts declared %s file family signatures without relying on MIME', (extension, bytes) => {
  expect(validateJoinProofs([proof(`proof.${extension}`,bytes)],'experienced')[0]!.extension).toBe(extension)
})
it.each([
  ['proof.png',Buffer.from('%PDF-')], ['proof.exe',Buffer.from('MZ')], ['proof.txt',Buffer.from([0xc3,0x28])],
  ['proof.txt',Buffer.from('nul\0')], ['proof.svg',Buffer.from('<!DOCTYPE svg><svg></svg>')],
  ['proof.svg',Buffer.from('<!ENTITY bad "x"><svg></svg>')], ['proof.svg',Buffer.from('<html></html>')],
])('rejects unsupported signature/text %s', (name, bytes) => {
  expect(() => validateJoinProofs([proof(name,bytes)],'experienced')).toThrow(code('JOIN_UNSUPPORTED_MEDIA_TYPE'))
})
it.each(['../proof.txt','a\\proof.txt','bad\r\n.txt','bad".txt','.','..','😀'.repeat(256)+'.txt'])('rejects unsafe filename %s', name => {
  expect(() => validateJoinProofs([proof(name)],'experienced')).toThrow(code('BAD_REQUEST'))
})
it('enforces zero/five/six attachments, actual byte lengths and 10MiB boundary', () => {
  const bytes = Buffer.alloc(MAX_PROOF_BYTES, 65)
  expect(validateJoinProofs([], 'new')).toEqual([])
  expect(validateJoinProofs(Array.from({ length: 5 }, () => proof('proof.txt', bytes)), 'experienced')).toHaveLength(5)
  expect(() => validateJoinProofs(Array.from({ length: 6 }, () => proof()),'experienced')).toThrow(code('JOIN_UPLOAD_TOO_LARGE'))
  expect(() => validateJoinProofs([proof('proof.txt',Buffer.alloc(MAX_PROOF_BYTES+1,65))],'experienced')).toThrow(code('JOIN_UPLOAD_TOO_LARGE'))
  expect(() => validateJoinProofs([proof('empty.txt',Buffer.alloc(0))],'experienced')).toThrow(code('BAD_REQUEST'))
  expect(() => validateJoinProofs([proof()],'new')).toThrow(code('BAD_REQUEST'))
})

it('returns all six minimal results without changing any business table', async () => {
  const f = setup()
  const query = (email: string, expected: object) => { const before = joinSnapshot(f); expect(f.joinServices.query({email})).toEqual(expected); expect(joinSnapshot(f)).toEqual(before) }
  query('unknown@example.com', {status:'not_found',nextAction:'apply'})
  await f.seedUser({email:'account@example.com',nickname:'Old account',password:'valid password'}); query('account@example.com',{status:'not_found',nextAction:'apply'})
  f.joinServices.submit(newJoinApplication()); query(' MEMBER@EXAMPLE.COM ',{status:'pending',nextAction:'wait'})
  f.joinServices.reject(rows(f)[0]!.id); query('member@example.com',{status:'rejected',nextAction:'contact_community'})
  await approvedInvitation(f,'approved@example.com'); f.sqlite.exec("UPDATE join_delivery_attempts SET status='failed' WHERE status='sent'")
  query('approved@example.com',{status:'approved',nextAction:'register'})
  f.advance(7*86_400_000); query('approved@example.com',{status:'invitation_expired',nextAction:'contact_community'})
  expect(f.sqlite.prepare('SELECT status FROM join_invitations').get()).toEqual({status:'active'})
  await registerInvited(f,'registered@example.com'); query('registered@example.com',{status:'registered',nextAction:'login'})
})
it('prioritizes completed historical user links over newer rejected history and stable IDs break time ties', async () => {
  const f = setup(); await registerInvited(f)
  f.sqlite.prepare("INSERT INTO join_applications (id,email,nickname,qq,status,created_at,reviewed_at) VALUES ('zz-new-rejected',?,'Old','1','rejected',?,?)").run('member@example.com',f.now()+1,f.now()+1)
  expect(f.joinServices.query({email:'member@example.com'})).toEqual({status:'registered',nextAction:'login'})
  f.sqlite.exec("INSERT INTO join_applications (id,email,nickname,qq,status,created_at,reviewed_at) VALUES ('a','ties@example.com','A','1','rejected',1,2), ('b','ties@example.com','B','1','pending',1,NULL)")
  expect(f.joinServices.query({email:'ties@example.com'})).toEqual({status:'pending',nextAction:'wait'})
})
it('rejects corrupt approved invitation associations with no query writes', async () => {
  const f = setup(); f.joinServices.submit(newJoinApplication()); f.sqlite.exec("UPDATE join_applications SET status='approved',reviewed_at=1")
  let before=joinSnapshot(f); expect(() => f.joinServices.query({email:'member@example.com'})).toThrow('inconsistent'); expect(joinSnapshot(f)).toEqual(before)
  const user = await f.seedUser({email:'other@example.com',nickname:'Other',password:'valid password'})
  f.sqlite.prepare("INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version,completed_user_id,completed_at) VALUES ('broken',?,'completed',1,2,1,?,2)").run(rows(f)[0]!.id,user)
  f.sqlite.pragma('foreign_keys = OFF'); f.sqlite.prepare('DELETE FROM auth_users WHERE id = ?').run(user); f.sqlite.pragma('foreign_keys = ON')
  before=joinSnapshot(f); expect(() => f.joinServices.query({email:'member@example.com'})).toThrow('inconsistent'); expect(joinSnapshot(f)).toEqual(before)
})
it.each(['missing','invalid-json','wrong-type','extra-field'])('fails corrupted version 1 reads safely: %s', variant => {
  const f = setup(); f.joinServices.submit(newJoinApplication()); const id=rows(f)[0]!.id
  if(variant==='missing') f.sqlite.prepare('DELETE FROM join_application_forms WHERE application_id=?').run(id)
  else if(variant==='invalid-json') f.sqlite.prepare('UPDATE join_application_forms SET form_json=? WHERE application_id=?').run('{',id)
  else if(variant==='wrong-type') f.sqlite.prepare("UPDATE join_application_forms SET application_type='experienced' WHERE application_id=?").run(id)
  else f.sqlite.prepare('UPDATE join_application_forms SET form_json=? WHERE application_id=?').run(JSON.stringify({...newJoinApplication().form,extra:true}),id)
  expect(() => f.joinServices.get(id)).toThrow(); expect(() => f.joinServices.list()).toThrow()
})
it('keeps genuine legacy records reviewable with no fabricated form or commitments', async () => {
  const f=setup(); f.sqlite.exec("INSERT INTO join_applications (id,email,nickname,qq,status,created_at) VALUES ('legacy','legacy@example.com','Old','1','pending',1)")
  expect(f.joinServices.get('legacy')).toMatchObject({formVersion:0,form:null,attachments:[],application:{applicationType:'legacy',qq:'1'}})
  expect((await f.joinServices.approve('legacy')).application.status).toBe('approved')
  const grant=f.invitationServices.verifyCode('legacy@example.com',f.deliveries[0]!.code)
  expect(await f.invitationServices.complete({completionToken:grant.completionToken,nickname:'Legacy',password:'valid password'})).toEqual({status:'registered',email:'legacy@example.com'})
})
it('does not SELECT attachment BLOBs for list/detail and scopes download to both IDs', () => {
  const f=setup(); f.joinServices.submit(experiencedJoinApplication(),[proof()]); const id=rows(f)[0]!.id
  const statements:string[]=[]; const prepare=f.sqlite.prepare.bind(f.sqlite)
  vi.spyOn(f.sqlite,'prepare').mockImplementation(sql => { statements.push(sql); return prepare(sql) })
  f.joinServices.list(); const result=f.joinServices.get(id)
  const attachmentQueries=statements.filter(sql=>sql.includes('join_application_attachments'))
  expect(attachmentQueries.length).toBeGreaterThan(0); expect(attachmentQueries.every(sql=>!sql.includes('bytes')&&!sql.includes('*'))).toBe(true)
  expect(() => f.joinServices.download('other',result.attachments[0]!.id)).toThrow(code('JOIN_ATTACHMENT_NOT_FOUND'))
  expect(() => f.joinServices.download(id,'missing')).toThrow(code('JOIN_ATTACHMENT_NOT_FOUND'))
})
it('does not approve or dispatch an invitation when version 1 form data is corrupt', async () => {
  const f=setup();f.joinServices.submit(newJoinApplication());const id=rows(f)[0]!.id
  f.sqlite.prepare('DELETE FROM join_application_forms WHERE application_id=?').run(id)
  const before=joinSnapshot(f);await expect(f.joinServices.approve(id)).rejects.toThrow('missing');expect(joinSnapshot(f)).toEqual(before);expect(f.deliveries).toEqual([])
})
it('persists five metadata entries in order and checks stored bytes against their digest on download',()=>{
  const f=setup();f.joinServices.submit(experiencedJoinApplication(),Array.from({length:5},(_,ordinal)=>proof(`${ordinal}.txt`,Buffer.from(`proof ${ordinal}`))))
  const id=rows(f)[0]!.id,result=f.joinServices.get(id)
  expect(result.attachments.map(file=>file.ordinal)).toEqual([0,1,2,3,4])
  const attachment=result.attachments[0]!
  f.sqlite.prepare('UPDATE join_application_attachments SET sha256=? WHERE id=?').run('0'.repeat(64),attachment.id)
  expect(()=>f.joinServices.download(id,attachment.id)).toThrow('inconsistent')
})
it('orders same-time invitations by ID and treats the exact expiration instant as expired without writes',async()=>{
  const f=setup(),approved=await approvedInvitation(f)
  f.sqlite.prepare("UPDATE join_invitations SET status='expired'").run()
  f.sqlite.prepare("INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version) VALUES ('zz-tie',?,'active',?,?,1)").run(approved.id,f.now(),f.now()+1000)
  expect(f.joinServices.query({email:approved.email})).toEqual({status:'approved',nextAction:'register'})
  f.advance(1000);const before=joinSnapshot(f)
  expect(f.joinServices.query({email:approved.email})).toEqual({status:'invitation_expired',nextAction:'contact_community'});expect(joinSnapshot(f)).toEqual(before)
})
it.each(['<svg/>','<?xml version="1.0"?><svg/>','\uFEFF\n<!-- root -->\n<svg/>','<svg xmlns="http://www.w3.org/2000/svg"/>'])('accepts a self-closing SVG root with ordinary XML prolog: %s',content=>{
  expect(validateJoinProofs([proof('root.svg',Buffer.from(content))],'experienced')[0]!.extension).toBe('svg')
})
it.each(['GIF87a','GIF89a'])('recognizes exact GIF signature %s',signature=>{
  expect(validateJoinProofs([proof('image.gif',Buffer.from(signature))],'experienced')[0]!.extension).toBe('gif')
})
it('rejects high-bit GIF bytes that lossy ASCII decoding disguises as GIF89a',()=>{
  expect(()=>validateJoinProofs([proof('image.gif',Buffer.from([0xc7,0xc9,0xc6,0xb8,0xb9,0xe1]))],'experienced')).toThrow(code('JOIN_UNSUPPORTED_MEDIA_TYPE'))
})
it.each([
  Buffer.from('<!DOCTYPE svg><svg/>'),Buffer.from('<?xml version="1.0"?><!ENTITY name "value"><svg/>'),
  Buffer.from('<svg>\0</svg>'),Buffer.from([0xc3,0x28]),Buffer.from('<?xml version="1.0"?><svg-like/>'),
])('retains SVG declaration, NUL, UTF-8 and non-root rejections %#',bytes=>{
  expect(()=>validateJoinProofs([proof('root.svg',bytes)],'experienced')).toThrow(code('JOIN_UNSUPPORTED_MEDIA_TYPE'))
})
