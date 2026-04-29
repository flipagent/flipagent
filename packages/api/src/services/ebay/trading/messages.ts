/**
 * Trading API: buyer ↔ seller messaging. eBay never built a REST
 * messaging surface; everything here flows through the legacy XML
 * API.
 *
 * The shapes we expose are flipagent-typed (camelCase, ISO dates) —
 * not eBay-XML-shaped. Callers don't see XML.
 */

import { arrayify, escapeXml, parseTrading, stringFrom, tradingCall } from "./client.js";

export interface MyMessage {
	messageId: string;
	externalMessageId: string | null;
	sender: string | null;
	recipient: string | null;
	subject: string | null;
	text: string | null;
	receiveDate: string | null;
	expirationDate: string | null;
	read: boolean | null;
	replied: boolean | null;
	flagged: boolean | null;
	itemId: string | null;
	folderId: string | null;
	messageType: string | null;
}

export interface GetMyMessagesArgs {
	accessToken: string;
	folderId?: number;
	startTime?: string; // ISO
	endTime?: string;
	pageNumber?: number;
	entriesPerPage?: number;
	detailLevel?: "ReturnHeaders" | "ReturnMessages" | "ReturnSummary";
}

export async function getMyMessages(args: GetMyMessagesArgs): Promise<MyMessage[]> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<DetailLevel>${args.detailLevel ?? "ReturnMessages"}</DetailLevel>
	${args.folderId != null ? `<FolderID>${args.folderId}</FolderID>` : ""}
	${args.startTime ? `<StartTime>${escapeXml(args.startTime)}</StartTime>` : ""}
	${args.endTime ? `<EndTime>${escapeXml(args.endTime)}</EndTime>` : ""}
	<Pagination>
		<EntriesPerPage>${args.entriesPerPage ?? 25}</EntriesPerPage>
		<PageNumber>${args.pageNumber ?? 1}</PageNumber>
	</Pagination>
</GetMyMessagesRequest>`;
	const xml = await tradingCall({ callName: "GetMyMessages", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "GetMyMessages");
	const container = (parsed.Messages ?? {}) as Record<string, unknown>;
	const rows = arrayify(container.Message);
	return rows.map((m) => ({
		messageId: stringFrom(m.MessageID) ?? "",
		externalMessageId: stringFrom(m.ExternalMessageID),
		sender: stringFrom(m.Sender),
		recipient: stringFrom(m.RecipientUserID),
		subject: stringFrom(m.Subject),
		text: stringFrom(m.Text),
		receiveDate: stringFrom(m.ReceiveDate),
		expirationDate: stringFrom(m.ExpirationDate),
		read: m.Read === true || m.Read === "true" ? true : m.Read === false || m.Read === "false" ? false : null,
		replied:
			m.Replied === true || m.Replied === "true"
				? true
				: m.Replied === false || m.Replied === "false"
					? false
					: null,
		flagged:
			m.Flagged === true || m.Flagged === "true"
				? true
				: m.Flagged === false || m.Flagged === "false"
					? false
					: null,
		itemId: stringFrom((m.ItemID ?? (m.Item as Record<string, unknown>)?.ItemID) as unknown),
		folderId: stringFrom(m.FolderID),
		messageType: stringFrom(m.MessageType),
	}));
}

export interface ReplyToBuyerArgs {
	accessToken: string;
	itemId: string;
	recipientUserId: string;
	parentMessageId: string;
	subject: string;
	body: string;
	emailCopyToSender?: boolean;
}

/**
 * Reply to a buyer's question on a listing (Trading
 * AddMemberMessageRTQ — "Respond To Question"). Sends the seller's
 * answer to the buyer who asked, scoped to one listing.
 */
export async function replyToBuyer(args: ReplyToBuyerArgs): Promise<{ ack: string }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ItemID>${escapeXml(args.itemId)}</ItemID>
	<MemberMessage>
		<Subject>${escapeXml(args.subject)}</Subject>
		<Body>${escapeXml(args.body)}</Body>
		<RecipientID>${escapeXml(args.recipientUserId)}</RecipientID>
		<ParentMessageID>${escapeXml(args.parentMessageId)}</ParentMessageID>
		${args.emailCopyToSender !== false ? "<EmailCopyToSender>true</EmailCopyToSender>" : ""}
	</MemberMessage>
</AddMemberMessageRTQRequest>`;
	const xml = await tradingCall({ callName: "AddMemberMessageRTQ", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "AddMemberMessageRTQ");
	return { ack: stringFrom(parsed.Ack) ?? "Unknown" };
}
