/**
 * Trading API: listing publish dry-run.
 *
 *   VerifyAddItem  — runs the publish-side validation eBay does on
 *                    AddItem, returns fees + errors without actually
 *                    creating the listing.
 *
 * Useful for "show the seller their final fees + any blocking errors
 * before they commit." The REST sell/inventory surface has no exact
 * dry-run equivalent — the closest is `validate` on the offer, which
 * doesn't return fee math.
 */

import { arrayify, escapeXml, parseTrading, stringFrom, tradingCall } from "./client.js";

export async function verifyAddItem(
	accessToken: string,
	args: {
		title: string;
		description: string;
		price: { value: string; currency: string };
		quantity: number;
		categoryId: string;
		condition: string;
		duration: string;
	},
): Promise<{
	ack: string;
	fees?: { value: string; currency: string };
	errors: Array<{ code: string; message: string }>;
}> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<VerifyAddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<Item>
		<Title>${escapeXml(args.title)}</Title>
		<Description>${escapeXml(args.description)}</Description>
		<PrimaryCategory><CategoryID>${escapeXml(args.categoryId)}</CategoryID></PrimaryCategory>
		<StartPrice currencyID="${escapeXml(args.price.currency)}">${escapeXml(args.price.value)}</StartPrice>
		<ConditionID>${escapeXml(args.condition)}</ConditionID>
		<Country>US</Country>
		<Currency>${escapeXml(args.price.currency)}</Currency>
		<DispatchTimeMax>3</DispatchTimeMax>
		<ListingDuration>${escapeXml(args.duration)}</ListingDuration>
		<ListingType>FixedPriceItem</ListingType>
		<Location>US</Location>
		<Quantity>${args.quantity}</Quantity>
	</Item>
</VerifyAddItemRequest>`;
	const xml = await tradingCall({ callName: "VerifyAddItem", accessToken, body });
	const parsed = parseTrading(xml, "VerifyAddItem");
	const ack = stringFrom(parsed.Ack) ?? "Unknown";
	const fees = (parsed.Fees as Record<string, unknown> | undefined) ?? undefined;
	let totalFee: { value: string; currency: string } | undefined;
	if (fees) {
		const feeArr = arrayify(fees.Fee as Record<string, unknown>);
		const total = feeArr.find((f) => stringFrom(f.Name) === "ListingFee");
		if (total) {
			const fee = total.Fee as { _: string; "@_currencyID": string };
			totalFee = { value: fee._ ?? "0", currency: fee["@_currencyID"] ?? "USD" };
		}
	}
	const errors: Array<{ code: string; message: string }> = [];
	const errArr = arrayify(parsed.Errors as Record<string, unknown>);
	for (const e of errArr) {
		errors.push({
			code: stringFrom(e.ErrorCode) ?? "",
			message: stringFrom(e.ShortMessage) ?? stringFrom(e.LongMessage) ?? "",
		});
	}
	return { ack, ...(totalFee ? { fees: totalFee } : {}), errors };
}
