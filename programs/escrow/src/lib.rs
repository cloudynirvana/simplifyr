use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("ESCRWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// ── Constants ────────────────────────────────────────────────────────────────
const FEE_BPS: u64 = 100; // 1%
const FEE_COLLECTOR: &str = "FEECxxx..."; // replace with your wallet

// ── Programme ────────────────────────────────────────────────────────────────
#[program]
pub mod escrow {
    use super::*;

    /// Buyer creates escrow + deposits SOL into the vault PDA.
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        milestone_count: u8,
        description: String,
        category: EscrowCategory,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(milestone_count > 0 && milestone_count <= 10, EscrowError::InvalidMilestones);
        require!(description.len() <= 256, EscrowError::DescriptionTooLong);

        let escrow = &mut ctx.accounts.escrow_state;
        escrow.escrow_id = escrow_id;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.milestone_count = milestone_count;
        escrow.milestones_completed = 0;
        escrow.description = description;
        escrow.category = category;
        escrow.state = EscrowStateEnum::Funded;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.bump = ctx.bumps.escrow_state;

        // Transfer SOL from buyer to vault PDA
        let transfer_ix = system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                transfer_ix,
            ),
            amount,
        )?;

        emit!(EscrowCreated {
            escrow_id,
            buyer: ctx.accounts.buyer.key(),
            seller: ctx.accounts.seller.key(),
            amount,
        });

        Ok(())
    }

    /// Seller marks a milestone complete; buyer confirms before funds release.
    pub fn complete_milestone(
        ctx: Context<MutateEscrow>,
        escrow_id: u64,
        milestone_index: u8,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require_keys_eq!(ctx.accounts.signer.key(), escrow.seller, EscrowError::UnauthorisedSeller);
        require!(escrow.state == EscrowStateEnum::Funded, EscrowError::InvalidState);
        require!(milestone_index < escrow.milestone_count, EscrowError::InvalidMilestoneIndex);

        escrow.milestones_completed = escrow.milestones_completed.saturating_add(1);

        emit!(MilestoneCompleted {
            escrow_id,
            milestone_index,
            seller: ctx.accounts.signer.key(),
        });

        Ok(())
    }

    /// Buyer confirms all milestones and triggers fund release to seller.
    pub fn release_funds(ctx: Context<ReleaseFunds>, escrow_id: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require_keys_eq!(ctx.accounts.buyer.key(), escrow.buyer, EscrowError::UnauthorisedBuyer);
        require!(escrow.state == EscrowStateEnum::Funded, EscrowError::InvalidState);
        require!(
            escrow.milestones_completed >= escrow.milestone_count,
            EscrowError::MilestonesIncomplete
        );

        let fee = escrow.amount * FEE_BPS / 10_000;
        let seller_amount = escrow.amount - fee;

        let seeds = &[
            b"vault",
            escrow_id.to_le_bytes().as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&seeds[..]];

        // Pay seller
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= seller_amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += seller_amount;

        // Pay fee
        if fee > 0 {
            **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_collector.to_account_info().try_borrow_mut_lamports()? += fee;
        }

        escrow.state = EscrowStateEnum::Released;

        emit!(FundsReleased {
            escrow_id,
            seller: ctx.accounts.seller.key(),
            amount: seller_amount,
            fee,
        });

        Ok(())
    }

    /// Buyer raises a dispute; locks escrow for Noah AI arbitration.
    pub fn raise_dispute(
        ctx: Context<MutateEscrow>,
        escrow_id: u64,
        reason: String,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require_keys_eq!(ctx.accounts.signer.key(), escrow.buyer, EscrowError::UnauthorisedBuyer);
        require!(escrow.state == EscrowStateEnum::Funded, EscrowError::InvalidState);
        require!(reason.len() <= 512, EscrowError::ReasonTooLong);

        escrow.state = EscrowStateEnum::Disputed;

        emit!(DisputeRaised {
            escrow_id,
            buyer: ctx.accounts.signer.key(),
            reason,
        });

        Ok(())
    }

    /// Noah AI agent resolves dispute: split = basis points to seller (0–10000).
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        escrow_id: u64,
        seller_split_bps: u16,
    ) -> Result<()> {
        // Only the designated Noah authority can call this
        let escrow = &mut ctx.accounts.escrow_state;
        require!(escrow.state == EscrowStateEnum::Disputed, EscrowError::NotDisputed);
        require!(seller_split_bps <= 10_000, EscrowError::InvalidSplit);

        let seller_amount = (escrow.amount * seller_split_bps as u64) / 10_000;
        let buyer_amount = escrow.amount - seller_amount;

        let seeds = &[
            b"vault",
            escrow_id.to_le_bytes().as_ref(),
            &[ctx.bumps.vault],
        ];

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= seller_amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += seller_amount;

        if buyer_amount > 0 {
            **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= buyer_amount;
            **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += buyer_amount;
        }

        escrow.state = EscrowStateEnum::Resolved;

        emit!(DisputeResolved {
            escrow_id,
            seller_split_bps,
            seller_amount,
            buyer_amount,
        });

        Ok(())
    }

    /// Mutual cancellation — buyer and seller both agree to refund.
    pub fn cancel_escrow(ctx: Context<ReleaseFunds>, escrow_id: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require!(
            escrow.state == EscrowStateEnum::Funded || escrow.state == EscrowStateEnum::Disputed,
            EscrowError::InvalidState
        );

        let seeds = &[
            b"vault",
            escrow_id.to_le_bytes().as_ref(),
            &[ctx.bumps.vault],
        ];

        let refund = escrow.amount;
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= refund;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += refund;

        escrow.state = EscrowStateEnum::Cancelled;

        emit!(EscrowCancelled { escrow_id });

        Ok(())
    }
}

// ── Accounts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = EscrowState::LEN,
        seeds = [b"escrow", escrow_id.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        init,
        payer = buyer,
        space = 0,
        seeds = [b"vault", escrow_id.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: PDA vault — holds lamports only
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: seller pubkey — stored in state, not a signer on creation
    pub seller: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct MutateEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_id.to_le_bytes().as_ref()],
        bump = escrow_state.bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct ReleaseFunds<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_id.to_le_bytes().as_ref()],
        bump = escrow_state.bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        mut,
        seeds = [b"vault", escrow_id.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: PDA vault — lamport transfer only
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    /// CHECK: seller receives funds
    pub seller: AccountInfo<'info>,

    #[account(mut, address = FEE_COLLECTOR.parse::<Pubkey>().unwrap())]
    /// CHECK: fee collector wallet
    pub fee_collector: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_id.to_le_bytes().as_ref()],
        bump = escrow_state.bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        mut,
        seeds = [b"vault", escrow_id.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: PDA vault
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: buyer receives refund portion
    pub buyer: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: seller receives their portion
    pub seller: AccountInfo<'info>,

    /// Noah AI agent authority — must match NOAH_AUTHORITY env
    pub noah_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct EscrowState {
    pub escrow_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub milestone_count: u8,
    pub milestones_completed: u8,
    pub state: EscrowStateEnum,
    pub category: EscrowCategory,
    pub description: String, // max 256
    pub created_at: i64,
    pub bump: u8,
}

impl EscrowState {
    pub const LEN: usize = 8   // discriminator
        + 8                    // escrow_id
        + 32                   // buyer
        + 32                   // seller
        + 8                    // amount
        + 1                    // milestone_count
        + 1                    // milestones_completed
        + 1                    // state enum
        + 1                    // category enum
        + 4 + 256              // description string
        + 8                    // created_at
        + 1;                   // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStateEnum {
    Funded,
    Disputed,
    Released,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowCategory {
    DigitalProduct,
    RealEstateDeed,
    DeSciGrant,
    Freelance,
    Generic,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct EscrowCreated {
    pub escrow_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MilestoneCompleted {
    pub escrow_id: u64,
    pub milestone_index: u8,
    pub seller: Pubkey,
}

#[event]
pub struct FundsReleased {
    pub escrow_id: u64,
    pub seller: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct DisputeRaised {
    pub escrow_id: u64,
    pub buyer: Pubkey,
    pub reason: String,
}

#[event]
pub struct DisputeResolved {
    pub escrow_id: u64,
    pub seller_split_bps: u16,
    pub seller_amount: u64,
    pub buyer_amount: u64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow_id: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Milestone count must be 1–10")]
    InvalidMilestones,
    #[msg("Description exceeds 256 characters")]
    DescriptionTooLong,
    #[msg("Dispute reason exceeds 512 characters")]
    ReasonTooLong,
    #[msg("Escrow is not in the required state for this operation")]
    InvalidState,
    #[msg("Escrow is not in Disputed state")]
    NotDisputed,
    #[msg("Only the buyer can perform this action")]
    UnauthorisedBuyer,
    #[msg("Only the seller can perform this action")]
    UnauthorisedSeller,
    #[msg("All milestones must be completed before releasing funds")]
    MilestonesIncomplete,
    #[msg("Milestone index out of range")]
    InvalidMilestoneIndex,
    #[msg("Split basis points must be 0–10000")]
    InvalidSplit,
}
