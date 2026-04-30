import { useEffect, useState } from "react";
import { apiBase } from "../lib/authClient";
import "./UserMenu.css";

type Profile = { id: string; name: string; image: string | null; role?: "user" | "admin" };

export default function UserMenu() {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			try {
				const res = await fetch(`${apiBase}/v1/me`, { credentials: "include" });
				if (res.ok) setProfile(await res.json());
			} catch {
				// ignore — show signed-out CTA
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	if (loading) return null;
	if (!profile) {
		return (
			<a href="/signup/" className="btn heat sm">
				Sign in
			</a>
		);
	}
	const isAdmin = profile.role === "admin";
	return (
		<>
			{isAdmin && (
				<a href="/admin/" className="user-menu-admin" aria-label="Open admin">
					Admin
				</a>
			)}
			<a href="/dashboard/" className="user-menu" aria-label="Open dashboard">
				{profile.image ? (
					<img src={profile.image} alt="" className="user-menu-avatar" />
				) : (
					<span className="user-menu-fallback">{profile.name?.[0]?.toUpperCase() ?? "?"}</span>
				)}
				<span className="user-menu-label">Dashboard</span>
			</a>
		</>
	);
}
